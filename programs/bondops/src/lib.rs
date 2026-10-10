use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Mint, MintTo, Token, TokenAccount, Transfer};

declare_id!("GtFrFiH2UxfLbiwAaEtVcfnNZ2zuygSmeqtRzfZ8tpQG");

pub const MAX_HOLDERS: usize = 32;
pub const MAX_PENDING: usize = 32;
pub const COUPON: u8 = 0;
pub const REDEMPTION: u8 = 1;
pub const VOTE: u8 = 2;

#[program]
pub mod bondops {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, id: u64, face_value: u64, annual_bps: u16,
        frequency: u8, periods: u8, interval_seconds: i64, label: String) -> Result<()> {
        require!(face_value > 0 && annual_bps <= 10_000 && annual_bps > 0,
            BondError::InvalidTerms);
        require!(frequency > 0 && frequency <= 12 && periods > 0 && periods <= 24
            && interval_seconds >= 3 && label.len() <= 64, BondError::InvalidTerms);
        require!(ctx.accounts.payment_mint.decimals == 6, BondError::InvalidPaymentMint);
        let now = Clock::get()?.unix_timestamp;
        let duration = interval_seconds.checked_mul(periods as i64).ok_or(BondError::Overflow)?;
        let maturity = now.checked_add(duration).ok_or(BondError::Overflow)?;
        let i = &mut ctx.accounts.instrument;
        i.id = id;
        i.issuer = ctx.accounts.issuer.key();
        i.bond_mint = ctx.accounts.bond_mint.key();
        i.payment_mint = ctx.accounts.payment_mint.key();
        i.face_value = face_value;
        i.annual_bps = annual_bps;
        i.frequency = frequency;
        i.periods = periods;
        i.interval_seconds = interval_seconds;
        i.started_at = now;
        i.maturity = maturity;
        i.label = label;
        i.bump = ctx.bumps.instrument;
        Ok(())
    }

    pub fn issue(ctx: Context<Issue>, owner: Pubkey, quantity: u64) -> Result<()> {
        let i = &mut ctx.accounts.instrument;
        require!(!i.sealed && i.phase == 0, BondError::IssuanceClosed);
        require!(Clock::get()?.unix_timestamp < i.maturity, BondError::Matured);
        require!(quantity > 0 && owner != Pubkey::default(), BondError::InvalidQuantity);
        let index = holder_index(&mut i.holders, owner)?;
        i.holders[index].quantity = add(i.holders[index].quantity, quantity)?;
        i.outstanding = add(i.outstanding, quantity)?;
        i.outstanding.checked_mul(i.face_value).ok_or(BondError::Overflow)?;
        let id = i.id.to_le_bytes();
        let seeds: &[&[u8]] = &[b"instrument", i.issuer.as_ref(), &id, &[i.bump]];
        token::mint_to(CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(),
            MintTo { mint: ctx.accounts.bond_mint.to_account_info(),
                to: ctx.accounts.bond_vault.to_account_info(), authority: i.to_account_info() },
            &[seeds]), quantity)?;
        emit!(PositionChanged { instrument: i.key(), owner, quantity: i.holders[index].quantity });
        Ok(())
    }

    pub fn seal(ctx: Context<Manage>) -> Result<()> {
        let i = &mut ctx.accounts.instrument;
        require!(!i.sealed && i.outstanding > 0, BondError::IssuanceClosed);
        require!(Clock::get()?.unix_timestamp < i.maturity, BondError::Matured);
        i.sealed = true;
        Ok(())
    }

    pub fn transfer_position(ctx: Context<TransferPosition>, recipient: Pubkey, quantity: u64) -> Result<()> {
        let i = &mut ctx.accounts.instrument;
        let now = Clock::get()?.unix_timestamp;
        require!(i.sealed && i.phase == 0 && now < i.maturity, BondError::Matured);
        require!(i.pending_record == 0 || now < i.pending_record, BondError::RecordDateLocked);
        require!(quantity > 0 && recipient != Pubkey::default()
            && recipient != ctx.accounts.owner.key(), BondError::InvalidQuantity);
        let from = i.holders.iter().position(|h| h.owner == ctx.accounts.owner.key())
            .ok_or(BondError::UnknownHolder)?;
        require!(i.holders[from].quantity >= quantity, BondError::InsufficientPosition);
        let to = holder_index(&mut i.holders, recipient)?;
        i.holders[from].quantity -= quantity;
        i.holders[to].quantity = add(i.holders[to].quantity, quantity)?;
        emit!(PositionChanged { instrument: i.key(), owner: recipient, quantity: i.holders[to].quantity });
        Ok(())
    }

    // Future actions are queued in advance. The earliest unsnapshotted record
    // date locks transfers, including when the executor is late or offline.
    pub fn schedule_action(ctx: Context<ScheduleAction>, nonce: u64, kind: u8,
        vote_record_at: i64, vote_duration: i64, proposal: String) -> Result<()> {
        let i = &mut ctx.accounts.instrument;
        let now = Clock::get()?.unix_timestamp;
        require!(i.sealed && i.phase == 0, BondError::ActionPending);
        require!(i.pending.len() < MAX_PENDING, BondError::QueueFull);
        require!(nonce == i.next_action && kind <= VOTE && proposal.len() <= 160,
            BondError::InvalidAction);
        let record_at;
        let amount_per_bond;
        let coupon_number;
        match kind {
            COUPON => {
                require!(i.coupons_scheduled < i.periods, BondError::AllCouponsScheduled);
                coupon_number = i.coupons_scheduled + 1;
                record_at = i.started_at.checked_add(i.interval_seconds.checked_mul(coupon_number as i64)
                    .ok_or(BondError::Overflow)?).ok_or(BondError::Overflow)?;
                // Floor once at the per-bond level, in payment-token micro-units.
                amount_per_bond = u64::try_from((i.face_value as u128)
                    .checked_mul(i.annual_bps as u128).ok_or(BondError::Overflow)?
                    / (10_000u128 * i.frequency as u128)).map_err(|_| BondError::Overflow)?;
                require!(amount_per_bond > 0, BondError::InvalidTerms);
                i.coupons_scheduled = coupon_number;
            },
            REDEMPTION => {
                require!(i.coupons_scheduled == i.periods, BondError::FinalCouponRequired);
                require!(!i.redemption_scheduled, BondError::InvalidAction);
                record_at = i.maturity;
                amount_per_bond = i.face_value;
                coupon_number = 0;
                i.redemption_scheduled = true;
            },
            _ => {
                require!(vote_record_at > now && vote_record_at < i.maturity
                    && vote_duration >= 3 && vote_duration <= 604_800 && !proposal.is_empty(),
                    BondError::InvalidAction);
                record_at = vote_record_at;
                amount_per_bond = 0;
                coupon_number = 0;
            }
        }
        // Late scheduling cannot reconstruct historical ownership. Reject it.
        // Redemption may be scheduled at/after maturity because maturity freezes transfers.
        require!(kind == REDEMPTION || record_at > now, BondError::MissedRecordDate);
        let a = &mut ctx.accounts.action;
        a.instrument = i.key();
        a.nonce = nonce;
        a.kind = kind;
        a.record_at = record_at;
        a.close_at = if kind == VOTE { record_at.checked_add(vote_duration).ok_or(BondError::Overflow)? } else { 0 };
        a.amount_per_bond = amount_per_bond;
        a.coupon_number = coupon_number;
        a.proposal = proposal;
        a.bump = ctx.bumps.action;
        i.next_action = add(i.next_action, 1)?;
        i.pending.push(PendingAction { address: a.key(), record_at, kind });
        i.pending.sort_by(|left, right| left.record_at.cmp(&right.record_at)
            .then(left.kind.cmp(&right.kind)));
        i.pending_record = i.pending[0].record_at;
        i.pending_action = i.pending[0].address;
        Ok(())
    }

    pub fn snapshot(ctx: Context<Snapshot>) -> Result<()> {
        let i = &mut ctx.accounts.instrument;
        let a = &mut ctx.accounts.action;
        let now = Clock::get()?.unix_timestamp;
        require!(a.status == 0 && i.pending_action == a.key(), BondError::InvalidAction);
        require!(now >= a.record_at, BondError::TooEarly);
        let mut total = 0u64;
        let mut due = 0u64;
        for h in &i.holders {
            let entitlement = h.quantity.checked_mul(a.amount_per_bond).ok_or(BondError::Overflow)?;
            total = add(total, h.quantity)?;
            due = add(due, entitlement)?;
            a.entries.push(Entitlement { owner: h.owner, quantity: h.quantity, amount: entitlement,
                paid: h.quantity == 0, voted: false, support: false, settled_at: 0 });
        }
        require!(total == i.outstanding && total == ctx.accounts.bond_vault.amount
            && total == ctx.accounts.bond_mint.supply, BondError::RegistryMismatch);
        a.total_quantity = total;
        a.total_due = due;
        a.snapshot_slot = Clock::get()?.slot;
        a.snapshot_at = now;
        a.status = 1;
        require!(!i.pending.is_empty() && i.pending[0].address == a.key(), BondError::InvalidAction);
        i.pending.remove(0);
        i.pending_record = i.pending.first().map(|p| p.record_at).unwrap_or(0);
        i.pending_action = i.pending.first().map(|p| p.address).unwrap_or_default();
        if a.kind == REDEMPTION { i.phase = 1; }
        emit!(SnapshotRecorded { action: a.key(), record_at: a.record_at, slot: a.snapshot_slot,
            total_quantity: total, total_due: due });
        Ok(())
    }

    pub fn fund(ctx: Context<Fund>, amount: u64) -> Result<()> {
        require!(ctx.accounts.action.kind != VOTE && ctx.accounts.action.status < 2 && amount > 0,
            BondError::InvalidAction);
        token::transfer(CpiContext::new(ctx.accounts.token_program.to_account_info(),
            Transfer { from: ctx.accounts.source.to_account_info(), to: ctx.accounts.payment_vault.to_account_info(),
                authority: ctx.accounts.issuer.to_account_info() }), amount)
    }

    pub fn reclaim_excess(ctx: Context<Fund>) -> Result<()> {
        let a = &ctx.accounts.action;
        require!(a.status == 2 && a.kind != VOTE, BondError::InvalidAction);
        let instrument_key = ctx.accounts.instrument.key();
        let nonce = a.nonce.to_le_bytes();
        let seeds: &[&[u8]] = &[b"action", instrument_key.as_ref(), &nonce, &[a.bump]];
        token::transfer(CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(),
            Transfer { from: ctx.accounts.payment_vault.to_account_info(),
                to: ctx.accounts.source.to_account_info(), authority: a.to_account_info() },
            &[seeds]), ctx.accounts.payment_vault.amount)
    }

    // Anyone can execute settlement, but only to the recorded investor's account.
    // The durable paid flag, payment CPI and optional burn share one transaction.
    pub fn settle(ctx: Context<Settle>, index: u8) -> Result<()> {
        let i = &mut ctx.accounts.instrument;
        let a = &mut ctx.accounts.action;
        require!(a.status == 1 && a.kind != VOTE, BondError::InvalidAction);
        let e = a.entries.get(index as usize).ok_or(BondError::UnknownHolder)?.clone();
        require!(!e.paid, BondError::AlreadySettled);
        require!(ctx.accounts.destination.owner == e.owner, BondError::WrongBeneficiary);
        // Require the entire outstanding obligation to be funded before any payment.
        require!(ctx.accounts.payment_vault.amount >= a.total_due.checked_sub(a.total_paid)
            .ok_or(BondError::Overflow)?, BondError::Underfunded);
        let a_nonce = a.nonce.to_le_bytes();
        let instrument_key = i.key();
        let a_seeds: &[&[u8]] = &[b"action", instrument_key.as_ref(), &a_nonce, &[a.bump]];
        token::transfer(CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(),
            Transfer { from: ctx.accounts.payment_vault.to_account_info(), to: ctx.accounts.destination.to_account_info(),
                authority: a.to_account_info() }, &[a_seeds]), e.amount)?;
        if a.kind == REDEMPTION {
            require!(i.phase == 1, BondError::InvalidAction);
            let holder = i.holders.iter_mut().find(|h| h.owner == e.owner).ok_or(BondError::UnknownHolder)?;
            require!(holder.quantity == e.quantity, BondError::RegistryMismatch);
            holder.quantity = 0;
            i.outstanding = i.outstanding.checked_sub(e.quantity).ok_or(BondError::Overflow)?;
            let id = i.id.to_le_bytes();
            let i_seeds: &[&[u8]] = &[b"instrument", i.issuer.as_ref(), &id, &[i.bump]];
            token::burn(CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(),
                Burn { mint: ctx.accounts.bond_mint.to_account_info(), from: ctx.accounts.bond_vault.to_account_info(),
                    authority: i.to_account_info() }, &[i_seeds]), e.quantity)?;
            a.burned_quantity = add(a.burned_quantity, e.quantity)?;
        }
        a.entries[index as usize].paid = true;
        a.entries[index as usize].settled_at = Clock::get()?.unix_timestamp;
        a.total_paid = add(a.total_paid, e.amount)?;
        if a.entries.iter().all(|entry| entry.paid) {
            a.status = 2;
            if a.kind == REDEMPTION { i.phase = 2; }
        }
        emit!(SettlementRecorded { action: a.key(), owner: e.owner, amount: e.amount,
            retired: if a.kind == REDEMPTION { e.quantity } else { 0 } });
        Ok(())
    }

    pub fn cast_vote(ctx: Context<CastVote>, index: u8, support: bool) -> Result<()> {
        let a = &mut ctx.accounts.action;
        require!(a.kind == VOTE && a.status == 1, BondError::InvalidAction);
        require!(Clock::get()?.unix_timestamp < a.close_at, BondError::VotingClosed);
        let e = a.entries.get_mut(index as usize).ok_or(BondError::UnknownHolder)?;
        require!(e.owner == ctx.accounts.owner.key() && e.quantity > 0, BondError::WrongBeneficiary);
        require!(!e.voted, BondError::AlreadyVoted);
        e.voted = true;
        e.support = support;
        let weight = e.quantity;
        if support { a.yes_weight = add(a.yes_weight, weight)?; }
        else { a.no_weight = add(a.no_weight, weight)?; }
        emit!(VoteRecorded { action: a.key(), owner: ctx.accounts.owner.key(), support, weight });
        Ok(())
    }

    pub fn finalize_vote(ctx: Context<FinalizeVote>) -> Result<()> {
        let a = &mut ctx.accounts.action;
        require!(a.kind == VOTE && a.status == 1, BondError::InvalidAction);
        require!(Clock::get()?.unix_timestamp >= a.close_at, BondError::TooEarly);
        // Fixed, published MVP rule: 50% participation, strict majority of cast votes.
        a.quorum_met = (add(a.yes_weight, a.no_weight)? as u128) * 2 >= a.total_quantity as u128;
        a.passed = a.quorum_met && a.yes_weight > a.no_weight;
        a.status = 2;
        Ok(())
    }
}

fn add(a: u64, b: u64) -> Result<u64> { a.checked_add(b).ok_or_else(|| error!(BondError::Overflow)) }
fn holder_index(holders: &mut Vec<Holder>, owner: Pubkey) -> Result<usize> {
    if let Some(index) = holders.iter().position(|h| h.owner == owner) { return Ok(index); }
    require!(holders.len() < MAX_HOLDERS, BondError::RegistryFull);
    holders.push(Holder { owner, quantity: 0 });
    Ok(holders.len() - 1)
}

#[derive(Accounts)]
#[instruction(id: u64)]
pub struct Initialize<'info> {
    #[account(mut)] pub issuer: Signer<'info>,
    #[account(init, payer = issuer, space = Instrument::SPACE,
        seeds = [b"instrument", issuer.key().as_ref(), &id.to_le_bytes()], bump)]
    pub instrument: Account<'info, Instrument>,
    #[account(init, payer = issuer, mint::decimals = 0, mint::authority = instrument)]
    pub bond_mint: Account<'info, Mint>,
    pub payment_mint: Account<'info, Mint>,
    #[account(init, payer = issuer, seeds = [b"bond-vault", instrument.key().as_ref()], bump,
        token::mint = bond_mint, token::authority = instrument)]
    pub bond_vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct Issue<'info> {
    pub issuer: Signer<'info>,
    #[account(mut, has_one = issuer, has_one = bond_mint,
        seeds = [b"instrument", instrument.issuer.as_ref(), &instrument.id.to_le_bytes()], bump = instrument.bump)]
    pub instrument: Account<'info, Instrument>,
    #[account(mut)] pub bond_mint: Account<'info, Mint>,
    #[account(mut, seeds = [b"bond-vault", instrument.key().as_ref()], bump,
        token::mint = bond_mint, token::authority = instrument)]
    pub bond_vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Manage<'info> {
    pub issuer: Signer<'info>,
    #[account(mut, has_one = issuer)] pub instrument: Account<'info, Instrument>,
}

#[derive(Accounts)]
pub struct TransferPosition<'info> {
    pub owner: Signer<'info>,
    #[account(mut)] pub instrument: Account<'info, Instrument>,
}

#[derive(Accounts)]
#[instruction(nonce: u64)]
pub struct ScheduleAction<'info> {
    #[account(mut)] pub issuer: Signer<'info>,
    #[account(mut, has_one = issuer, has_one = payment_mint)] pub instrument: Account<'info, Instrument>,
    #[account(init, payer = issuer, space = Action::SPACE,
        seeds = [b"action", instrument.key().as_ref(), &nonce.to_le_bytes()], bump)]
    pub action: Account<'info, Action>,
    pub payment_mint: Account<'info, Mint>,
    #[account(init, payer = issuer, seeds = [b"payment-vault", action.key().as_ref()], bump,
        token::mint = payment_mint, token::authority = action)]
    pub payment_vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct Snapshot<'info> {
    #[account(mut, has_one = bond_mint)] pub instrument: Account<'info, Instrument>,
    #[account(mut, has_one = instrument)] pub action: Account<'info, Action>,
    pub bond_mint: Account<'info, Mint>,
    #[account(seeds = [b"bond-vault", instrument.key().as_ref()], bump,
        token::mint = bond_mint, token::authority = instrument)] pub bond_vault: Account<'info, TokenAccount>,
}

#[derive(Accounts)]
pub struct Fund<'info> {
    pub issuer: Signer<'info>,
    #[account(has_one = issuer, has_one = payment_mint)] pub instrument: Account<'info, Instrument>,
    #[account(has_one = instrument)] pub action: Account<'info, Action>,
    pub payment_mint: Account<'info, Mint>,
    #[account(mut, token::mint = payment_mint, token::authority = issuer)] pub source: Account<'info, TokenAccount>,
    #[account(mut, seeds = [b"payment-vault", action.key().as_ref()], bump,
        token::mint = payment_mint, token::authority = action)] pub payment_vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Settle<'info> {
    #[account(mut, has_one = bond_mint, has_one = payment_mint,
        seeds = [b"instrument", instrument.issuer.as_ref(), &instrument.id.to_le_bytes()], bump = instrument.bump)]
    pub instrument: Account<'info, Instrument>,
    #[account(mut, has_one = instrument, seeds = [b"action", instrument.key().as_ref(),
        &action.nonce.to_le_bytes()], bump = action.bump)] pub action: Account<'info, Action>,
    #[account(mut)] pub bond_mint: Account<'info, Mint>,
    pub payment_mint: Account<'info, Mint>,
    #[account(mut, seeds = [b"bond-vault", instrument.key().as_ref()], bump,
        token::mint = bond_mint, token::authority = instrument)] pub bond_vault: Account<'info, TokenAccount>,
    #[account(mut, seeds = [b"payment-vault", action.key().as_ref()], bump,
        token::mint = payment_mint, token::authority = action)] pub payment_vault: Account<'info, TokenAccount>,
    #[account(mut, token::mint = payment_mint)] pub destination: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct CastVote<'info> {
    pub owner: Signer<'info>,
    #[account(mut)] pub action: Account<'info, Action>,
}

#[derive(Accounts)]
pub struct FinalizeVote<'info> {
    #[account(mut)] pub action: Account<'info, Action>,
}

#[account]
pub struct Instrument {
    pub id: u64,
    pub issuer: Pubkey,
    pub bond_mint: Pubkey,
    pub payment_mint: Pubkey,
    pub face_value: u64,
    pub annual_bps: u16,
    pub frequency: u8,
    pub periods: u8,
    pub interval_seconds: i64,
    pub started_at: i64,
    pub maturity: i64,
    pub outstanding: u64,
    pub sealed: bool,
    pub phase: u8,
    pub coupons_scheduled: u8,
    pub next_action: u64,
    pub pending_record: i64,
    pub pending_action: Pubkey,
    pub redemption_scheduled: bool,
    pub bump: u8,
    pub label: String,
    pub holders: Vec<Holder>,
    pub pending: Vec<PendingAction>,
}
impl Instrument { pub const SPACE: usize = 8 + 400 + MAX_HOLDERS * 40 + MAX_PENDING * 41; }

#[account]
pub struct Action {
    pub instrument: Pubkey,
    pub nonce: u64,
    pub kind: u8,
    pub status: u8,
    pub record_at: i64,
    pub close_at: i64,
    pub amount_per_bond: u64,
    pub coupon_number: u8,
    pub snapshot_slot: u64,
    pub snapshot_at: i64,
    pub total_quantity: u64,
    pub total_due: u64,
    pub total_paid: u64,
    pub burned_quantity: u64,
    pub yes_weight: u64,
    pub no_weight: u64,
    pub quorum_met: bool,
    pub passed: bool,
    pub bump: u8,
    pub proposal: String,
    pub entries: Vec<Entitlement>,
}
impl Action { pub const SPACE: usize = 8 + 350 + MAX_HOLDERS * 59; }

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct Holder { pub owner: Pubkey, pub quantity: u64 }
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct PendingAction { pub address: Pubkey, pub record_at: i64, pub kind: u8 }
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct Entitlement {
    pub owner: Pubkey, pub quantity: u64, pub amount: u64, pub paid: bool,
    pub voted: bool, pub support: bool, pub settled_at: i64,
}

#[event] pub struct PositionChanged { pub instrument: Pubkey, pub owner: Pubkey, pub quantity: u64 }
#[event] pub struct SnapshotRecorded { pub action: Pubkey, pub record_at: i64, pub slot: u64, pub total_quantity: u64, pub total_due: u64 }
#[event] pub struct SettlementRecorded { pub action: Pubkey, pub owner: Pubkey, pub amount: u64, pub retired: u64 }
#[event] pub struct VoteRecorded { pub action: Pubkey, pub owner: Pubkey, pub support: bool, pub weight: u64 }

#[error_code]
pub enum BondError {
    #[msg("Invalid instrument terms")] InvalidTerms,
    #[msg("Payment mint must have 6 decimals")] InvalidPaymentMint,
    #[msg("Checked arithmetic overflow")] Overflow,
    #[msg("Issuance is closed")] IssuanceClosed,
    #[msg("Instrument matured or transfers are unavailable")] Matured,
    #[msg("Invalid position quantity or recipient")] InvalidQuantity,
    #[msg("Unknown holder")] UnknownHolder,
    #[msg("Insufficient position")] InsufficientPosition,
    #[msg("Record date reached: transfers locked until snapshot")] RecordDateLocked,
    #[msg("Instrument is not sealed or is already redeeming")] ActionPending,
    #[msg("Invalid corporate action or state")] InvalidAction,
    #[msg("All coupons already scheduled")] AllCouponsScheduled,
    #[msg("Schedule and snapshot the final coupon before redemption")] FinalCouponRequired,
    #[msg("Record date missed: historical balances cannot be reconstructed")] MissedRecordDate,
    #[msg("On-chain record date or close time has not arrived")] TooEarly,
    #[msg("Token supply, vault and registry do not reconcile")] RegistryMismatch,
    #[msg("This entitlement was already settled")] AlreadySettled,
    #[msg("Account is not owned by the recorded beneficiary")] WrongBeneficiary,
    #[msg("Fund the complete outstanding obligation before settlement")] Underfunded,
    #[msg("Voting window is closed")] VotingClosed,
    #[msg("Holder already voted")] AlreadyVoted,
    #[msg("Registry capacity is 32 wallets")] RegistryFull,
    #[msg("Pending action capacity is 32")] QueueFull,
}
