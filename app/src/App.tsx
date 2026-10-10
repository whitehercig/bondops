import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronDown,
  CircleHelp,
  Download,
  ExternalLink,
  FileText,
  Layers3,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  Wallet,
  X,
} from "lucide-react";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  COUPON,
  REDEMPTION,
  VOTE,
  LOCAL_RPC,
  DEVNET_RPC,
  PROGRAM_ID,
  createDemo,
  fetchState,
  schedule,
  snapshot,
  fund,
  reclaimExcess,
  settle,
  transfer,
  vote,
  finalizeVote,
  dollars,
  shortAddress,
  explorer,
  titleFor,
  describeError,
  chainTime,
} from "./client";
import type { ActionRecord, ChainState, DemoSession, Receipt } from "./client";

const people = ["Aida", "Timur", "Dana"];
const initials = ["AK", "TS", "DM"];
type View = "overview" | "actions" | "investors" | "audit";
const views: { id: View; label: string; icon: typeof Layers3 }[] = [
  { id: "overview", label: "Overview", icon: Layers3 },
  { id: "actions", label: "Corporate actions", icon: FileText },
  { id: "investors", label: "Holder registry", icon: Wallet },
  { id: "audit", label: "Audit trail", icon: ShieldCheck },
];
const clock = (seconds: number) =>
  new Date(seconds * 1000).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
const names = (owner: PublicKey, s: DemoSession) => {
  const index = s.investors.findIndex((k) => k.publicKey.equals(owner));
  return index >= 0 ? people[index] : shortAddress(owner);
};

function restore(): DemoSession | null {
  try {
    const saved = sessionStorage.getItem("bondops-session");
    if (!saved) return null;
    const s = JSON.parse(saved);
    return {
      issuer: Keypair.fromSecretKey(Uint8Array.from(s.issuer)),
      investors: s.investors.map((k: number[]) =>
        Keypair.fromSecretKey(Uint8Array.from(k)),
      ),
      instrument: new PublicKey(s.instrument),
      paymentMint: new PublicKey(s.paymentMint),
      bondMint: new PublicKey(s.bondMint),
      rpc: s.rpc,
    };
  } catch {
    return null;
  }
}

export default function App() {
  const [view, setView] = useState<View>("overview");
  const [session, setSession] = useState<DemoSession | null>(restore);
  const [state, setState] = useState<ChainState | null>(null);
  const [rpc, setRpc] = useState(session?.rpc || LOCAL_RPC);
  const [receipts, setReceipts] = useState<Receipt[]>(() => {
    try {
      return JSON.parse(sessionStorage.getItem("bondops-receipts") || "[]");
    } catch {
      return [];
    }
  });
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [online, setOnline] = useState(false);
  const [selected, setSelected] = useState<string>("");
  const [showGuide, setShowGuide] = useState(false);
  const [actionKind, setActionKind] = useState(VOTE);
  const [investor, setInvestor] = useState(0);
  const [auditJson, setAuditJson] = useState("");
  const loading = useRef(false);

  const append = useCallback(
    (r: Receipt) =>
      setReceipts((old) => {
        const next = [r, ...old];
        sessionStorage.setItem("bondops-receipts", JSON.stringify(next));
        return next;
      }),
    [],
  );
  const refresh = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    try {
      if (session) {
        const s = await fetchState(session);
        setState(s);
        setOnline(true);
      } else {
        const c = new Connection(rpc, "confirmed");
        const account = await c.getAccountInfo(PROGRAM_ID);
        setOnline(!!account?.executable);
      }
    } catch {
      setOnline(false);
    } finally {
      loading.current = false;
    }
  }, [session, rpc]);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => clearInterval(timer);
  }, [refresh]);

  async function run(label: string, task: () => Promise<string | void>) {
    if (busy) return;
    setBusy(label);
    setError("");
    setNotice("");
    try {
      const signature = await task();
      if (signature) append({ label, signature, at: Date.now() });
      setNotice(`${label} confirmed on Solana.`);
      await refresh();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy("");
    }
  }

  async function launch() {
    await run("Initialize demo", async () => {
      const s = await createDemo(rpc, append, 60, 2);
      setSession(s);
      sessionStorage.setItem(
        "bondops-session",
        JSON.stringify({
          issuer: Array.from(s.issuer.secretKey),
          investors: s.investors.map((k) => Array.from(k.secretKey)),
          instrument: s.instrument.toString(),
          bondMint: s.bondMint.toString(),
          paymentMint: s.paymentMint.toString(),
          rpc,
        }),
      );
      setState(await fetchState(s));
      setShowGuide(true);
      const now = await chainTime(new Connection(rpc, "confirmed"));
      const a = await schedule(
        s,
        VOTE,
        now + 8,
        25,
        "Approve publication of quarterly project progress reports.",
      );
      append({
        label: "Schedule reporting vote",
        signature: a.signature,
        at: Date.now(),
      });
      for (const kind of [COUPON, COUPON, REDEMPTION]) {
        const future = await schedule(s, kind);
        append({
          label:
            kind === COUPON
              ? "Queue contractual coupon"
              : "Queue maturity redemption",
          signature: future.signature,
          at: Date.now(),
        });
      }
      setState(await fetchState(s));
      setSelected(a.address.toString());
      setView("actions");
    });
  }

  const i = state?.instrument;
  const actions = state?.actions || [];
  const active =
    actions.find((a) => a.address.toString() === selected) ||
    actions.find((a) => a.status < 2) ||
    actions.at(-1);
  const pending = actions.find((a) =>
    a.address.equals(i?.pendingAction || PublicKey.default),
  );
  const chainNow = state?.now || 0;
  const matured = !!i && chainNow >= i.maturity.toNumber();
  const locked =
    !!i &&
    (i.phase > 0 ||
      matured ||
      (i.pendingRecord.toNumber() > 0 &&
        chainNow >= i.pendingRecord.toNumber()));
  const totalDue = actions.reduce(
    (sum, a) => sum + BigInt(a.totalDue.toString()),
    0n,
  );
  const totalPaid = actions.reduce(
    (sum, a) => sum + BigInt(a.totalPaid.toString()),
    0n,
  );
  const reconciled =
    !!state &&
    BigInt(i!.outstanding.toString()) === state.supply &&
    state.supply === state.custody;

  async function createAction() {
    if (!session) return;
    await run("Schedule corporate action", async () => {
      const now = await chainTime(new Connection(session.rpc, "confirmed"));
      const a = await schedule(
        session,
        actionKind,
        now + 8,
        25,
        "Approve publication of quarterly project progress reports.",
      );
      setSelected(a.address.toString());
      return a.signature;
    });
  }

  async function processAll(a: ActionRecord, firstOnly = false) {
    if (!session) return;
    await run(
      firstOnly ? "Pay first pending holder" : "Resume settlement",
      async () => {
        // Fetch durable chain flags every time, including after a reload or interruption.
        const latest = (await fetchState(session)).actions.find((x) =>
          x.address.equals(a.address),
        )!;
        const todo = latest.entries
          .map((e, index) => ({ e, index }))
          .filter(({ e }) => !e.paid);
        for (const { e, index } of firstOnly ? todo.slice(0, 1) : todo) {
          const signature = await settle(session, a.address, index, e.owner);
          append({
            label: `${titleFor(a)} · ${names(e.owner, session)}`,
            signature,
            at: Date.now(),
          });
        }
      },
    );
  }

  function resetSession() {
    sessionStorage.removeItem("bondops-session");
    sessionStorage.removeItem("bondops-receipts");
    setSession(null);
    setState(null);
    setReceipts([]);
    setSelected("");
    setError("");
    setNotice("");
    setView("overview");
  }

  function downloadAudit() {
    if (!state || !session) return;
    const payload = {
      product: "BondOps",
      version: "0.1.0",
      network: session.rpc,
      program: PROGRAM_ID.toString(),
      instrument: session.instrument.toString(),
      generatedAt: new Date().toISOString(),
      chainTime: state.now,
      limitations: [
        "DemoUSD is a test token, not dollars.",
        "Program custody; maximum 32 holders.",
        "Identity and KASE connectivity are simulated.",
        "Timetable accelerated for demonstration.",
      ],
      terms: {
        faceValueMicrounits: i!.faceValue.toString(),
        annualBps: i!.annualBps,
        frequency: i!.frequency,
        maturity: i!.maturity.toString(),
      },
      reconciliation: {
        outstanding: i!.outstanding.toString(),
        tokenSupply: state.supply.toString(),
        custody: state.custody.toString(),
        totalDue: totalDue.toString(),
        totalPaid: totalPaid.toString(),
      },
      holders: i!.holders.map((h) => ({
        owner: h.owner.toString(),
        quantity: h.quantity.toString(),
      })),
      actions: actions.map((a) => ({
        address: a.address.toString(),
        kind: titleFor(a),
        status: a.status,
        recordAt: a.recordAt.toString(),
        snapshotSlot: a.snapshotSlot.toString(),
        snapshotAt: a.snapshotAt.toString(),
        totalDue: a.totalDue.toString(),
        totalPaid: a.totalPaid.toString(),
        burnedQuantity: a.burnedQuantity.toString(),
        quorumMet: a.quorumMet,
        passed: a.passed,
        entries: a.entries.map((e) => ({
          owner: e.owner.toString(),
          quantity: e.quantity.toString(),
          amount: e.amount.toString(),
          paid: e.paid,
          voted: e.voted,
          support: e.support,
          settledAt: e.settledAt.toString(),
        })),
      })),
      browserReceipts: receipts,
    };
    setAuditJson(JSON.stringify(payload, null, 2));
  }

  const disabled = !!busy || !online;
  return (
    <div className="app-shell">
      {auditJson && <dialog className="audit-export" ref={element => { if (element && !element.open) element.showModal(); }} onCancel={() => setAuditJson("")}>
        <div className="panel-heading"><div><h2 id="audit-export-title">Verifiable evidence</h2><p>Public addresses, obligations and outcomes. No signing keys.</p></div><button className="icon-button" aria-label="Close evidence" onClick={() => setAuditJson("")}><X size={18} /></button></div>
        <textarea aria-label="Evidence JSON" readOnly value={auditJson} spellCheck={false} />
        <div className="export-footer"><span>Select the JSON to copy, or save the evidence file.</span><a className="button primary" download="bondops-audit.json" href={`data:application/json;charset=utf-8,${encodeURIComponent(auditJson)}`}><Download size={15} />Download JSON</a></div>
      </dialog>}
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setView("overview");
          }}
        >
          <span className="brand-mark">
            <i />
            <i />
            <i />
          </span>
          bondops<span className="brand-dot">.</span>
        </a>
        <div className="workspace">
          <div className="workspace-avatar">K</div>
          <div>
            <strong>Kazakhstan sandbox</strong>
            <span>Issuer workspace</span>
          </div>
          <ChevronDown size={15} />
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          {views.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              aria-label={label}
              className={`nav-item ${view === id ? "active" : ""}`}
              onClick={() => setView(id)}
            >
              <Icon size={18} />
              <span>{label}</span>
              {id === "actions" && actions.length > 0 && (
                <small>{actions.length}</small>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <span className="tiny-label">BUILT ON SOLANA</span>
          <p>
            Every entitlement.
            <br />
            Every payment.
            <br />
            Accounted for.
          </p>
          <div className="solana-lines">
            <i />
            <i />
            <i />
          </div>
        </div>
        <div className="sidebar-bottom">
          <button onClick={() => setShowGuide(!showGuide)}>
            <CircleHelp size={17} /> Demo guide <ArrowUpRight size={14} />
          </button>
          <div className="profile">
            <div className="avatar small">OP</div>
            <div>
              <strong>Demo operator</strong>
              <span>Sandbox signing keys</span>
            </div>
          </div>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <span>/</span>{" "}
            <strong>{views.find((v) => v.id === view)?.label}</strong>
          </div>
          <div className="topbar-right">
            {session && (
              <button
                className="button secondary"
                disabled={!!busy}
                onClick={resetSession}
              >
                New demo
              </button>
            )}
            <span className={`network-pill ${online ? "online" : ""}`}>
              <i />
              {rpc === LOCAL_RPC ? "Local validator" : "Solana devnet"}
            </span>
            <button
              className="icon-button"
              aria-label="Refresh chain state"
              onClick={() => void refresh()}
            >
              <RefreshCw size={17} />
            </button>
            <div className="avatar small">OP</div>
          </div>
        </header>
        <div className="content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">BOND SERVICING / SOLANA</div>
              <h1>
                {view === "overview"
                  ? "Corporate actions, accounted for."
                  : view === "actions"
                    ? "Move obligations to outcomes."
                    : view === "investors"
                      ? "Rights begin with the registry."
                      : "A record you can verify."}
              </h1>
              <p>
                {view === "overview"
                  ? "One workspace for the complete lifecycle of your tokenized bonds."
                  : view === "actions"
                    ? "Record dates, entitlements and settlement — with an on-chain receipt."
                    : view === "investors"
                      ? "Current positions and historical entitlements, side by side."
                      : "Reconcile obligations against payments and retired token supply."}
              </p>
            </div>
            <button
              className="button secondary"
              onClick={() => setShowGuide(!showGuide)}
            >
              <CircleHelp size={16} /> Demo guide
            </button>
          </div>

          <div className="sandbox-banner">
            <div>
              <ShieldCheck size={17} />
              <span>
                <strong>Functional Solana prototype.</strong> DemoUSD is a test
                token. Identity and KASE connectivity are simulated.
              </span>
            </div>
            <span className="mono">v0.1 / 32 holders max</span>
          </div>
          {busy && (
            <div className="feedback busy" role="status">
              <LoaderCircle size={17} className="spin" />
              {busy}… waiting for confirmation
            </div>
          )}
          {error && (
            <div className="feedback error" role="alert">
              <X size={17} />
              <span>{error}</span>
              <button onClick={() => setError("")} aria-label="Dismiss error">
                <X size={15} />
              </button>
            </div>
          )}
          {notice && !busy && (
            <div className="feedback success" role="status">
              <Check size={17} />
              {notice}
            </div>
          )}

          {showGuide && (
            <div className="guide">
              <div>
                <span className="tiny-label">A TWO-MINUTE LIFECYCLE</span>
                <h3>Make the edge cases visible.</h3>
              </div>
              <ol>
                <li>Launch demo; snapshot the vote after its record date.</li>
                <li>
                  Vote, then transfer four bonds from Aida to Timur. Vote
                  weights stay fixed.
                </li>
                <li>
                  Coupon 1 is already queued. At 01:00, snapshot, fund, pay one
                  holder, then resume.
                </li>
                <li>
                  Coupon 2 is already queued. At 02:00, snapshot, fund and
                  settle.
                </li>
                <li>
                  Snapshot the queued redemption, fund and settle; supply
                  becomes zero.
                </li>
              </ol>
              <button
                className="icon-button"
                onClick={() => setShowGuide(false)}
                aria-label="Close guide"
              >
                <X size={18} />
              </button>
            </div>
          )}

          {!session ? (
            <>
              <section className="hero-card">
                <div className="hero-copy">
                  <span className="tag">YOUR FIRST INSTRUMENT</span>
                  <h2>
                    From issuance
                    <br />
                    to the last payment.
                  </h2>
                  <p>
                    Launch a real, isolated on-chain demo with three investors,
                    two coupon periods and a reporting vote.
                  </p>
                  <div className="launch-row">
                    <button
                      className="button primary"
                      disabled={disabled}
                      onClick={() => void launch()}
                    >
                      {busy ? (
                        <LoaderCircle className="spin" size={16} />
                      ) : (
                        <ArrowRight size={17} />
                      )}
                      Launch on-chain demo
                    </button>
                    <select
                      aria-label="Solana network"
                      value={rpc}
                      onChange={(e) => setRpc(e.target.value)}
                      disabled={!!busy}
                    >
                      <option value={LOCAL_RPC}>Localnet</option>
                      <option value={DEVNET_RPC}>Devnet</option>
                    </select>
                  </div>
                  <span className="hero-footnote">
                    {online
                      ? "Program detected · ready to create a test instrument"
                      : "Validator unavailable · run npm run localnet, then refresh"}
                  </span>
                </div>
                <div className="hero-visual">
                  <span className="tiny-label">THE BONDOPS LIFECYCLE</span>
                  <div className="lifecycle">
                    <div>
                      <span>01</span>
                      <strong>Record</strong>
                      <small>Who holds the right?</small>
                    </div>
                    <div>
                      <span>02</span>
                      <strong>Calculate</strong>
                      <small>What are they owed?</small>
                    </div>
                    <div>
                      <span>03</span>
                      <strong>Settle</strong>
                      <small>Execute the obligation.</small>
                    </div>
                    <div>
                      <span>04</span>
                      <strong>Verify</strong>
                      <small>Prove the outcome.</small>
                    </div>
                  </div>
                  <div className="proof-pill">
                    <ShieldCheck size={15} /> Immutable action records on Solana
                  </div>
                </div>
              </section>
              <div className="section-heading">
                <h2>Three actions. One servicing engine.</h2>
                <span>REQUIRED SCENARIOS</span>
              </div>
              <div className="scenario-grid">
                {[
                  {
                    n: "01",
                    name: "Coupon payment",
                    copy: "Fixed-date rights. Integer calculations. Resumable payments.",
                    icon: ArrowDownLeft,
                  },
                  {
                    n: "02",
                    name: "Bond redemption",
                    copy: "Principal payment and token burn, in the same transaction.",
                    icon: CheckCheck,
                  },
                  {
                    n: "03",
                    name: "Bondholder voting",
                    copy: "Snapshot voting weights, one ballot per holder, verifiable results.",
                    icon: FileText,
                  },
                ].map(({ n, name, copy, icon: Icon }) => (
                  <article className="scenario" key={n}>
                    <div>
                      <Icon size={21} />
                      <span>{n}</span>
                    </div>
                    <h3>{name}</h3>
                    <p>{copy}</p>
                    <span className="text-link">
                      Implemented in Solana <Check size={13} />
                    </span>
                  </article>
                ))}
              </div>
            </>
          ) : !state ? (
            <div className="empty-state">
              <LoaderCircle className="spin" />
              <h2>Loading your on-chain instrument</h2>
              <p>If the validator was reset, start a new demo session.</p>
              <button
                className="button secondary"
                onClick={() => {
                  sessionStorage.removeItem("bondops-session");
                  sessionStorage.removeItem("bondops-receipts");
                  setSession(null);
                  setReceipts([]);
                }}
              >
                Start a new session
              </button>
            </div>
          ) : (
            <>
              <section className="instrument-strip">
                <div className="instrument-icon">
                  <Layers3 size={24} />
                </div>
                <div>
                  <div className="instrument-title">
                    <h2>{i!.label}</h2>
                    <span
                      className={`status ${i!.phase === 2 ? "completed" : ""}`}
                    >
                      {i!.phase === 2
                        ? "Redeemed"
                        : i!.phase === 1
                          ? "Redeeming"
                          : "Active"}
                    </span>
                  </div>
                  <span className="mono">
                    {shortAddress(session.instrument)}{" "}
                    <a
                      href={explorer(
                        session.instrument.toString(),
                        session.rpc,
                        "address",
                      )}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="Open instrument in Solana Explorer"
                    >
                      <ExternalLink size={12} />
                    </a>{" "}
                    <span className="divider">|</span> Demo timetable ·{" "}
                    {i!.periods} periods × {i!.intervalSeconds.toString()}s
                  </span>
                </div>
                <div className="instrument-right">
                  <span
                    className={`status ${locked ? "pending" : "completed"}`}
                  >
                    {locked ? <LockKeyhole size={12} /> : <Check size={12} />}
                    {locked ? "Transfers locked" : "Registry reconciled"}
                  </span>
                  <span>Chain time {clock(chainNow)}</span>
                </div>
              </section>

              <div className="metric-grid">
                <Metric
                  label="Outstanding principal"
                  value={dollars(
                    BigInt(i!.outstanding.toString()) *
                      BigInt(i!.faceValue.toString()),
                  )}
                  note={`${i!.outstanding.toString()} bonds · ${dollars(i!.faceValue)} face value`}
                />
                <Metric
                  label="Coupon per bond"
                  value={dollars(
                    (BigInt(i!.faceValue.toString()) * BigInt(i!.annualBps)) /
                      BigInt(10000 * i!.frequency),
                  )}
                  note={`${i!.annualBps / 100}% annual rate · ${i!.frequency} payments / year`}
                />
                <Metric
                  label="Paid to investors"
                  value={dollars(totalPaid)}
                  note={`${actions.filter((a) => a.status === 2 && a.kind !== VOTE).length} payment actions completed`}
                  green
                />
                <Metric
                  label="Remaining obligation"
                  value={dollars(totalDue - totalPaid)}
                  note={`${actions.filter((a) => a.status === 1 && a.kind !== VOTE).length} actions awaiting settlement`}
                />
              </div>

              {(view === "overview" || view === "actions") && (
                <div className="work-grid">
                  <section className="panel actions-panel">
                    <div className="panel-heading">
                      <div>
                        <h2>Corporate actions</h2>
                        <p>Each obligation has a clear next step.</p>
                      </div>
                      <span className="count-badge">{actions.length}</span>
                    </div>
                    <div className="action-list">
                      {actions.length === 0 ? (
                        <div className="empty-small">
                          Schedule the first corporate action below.
                        </div>
                      ) : (
                        actions.map((a) => (
                          <button
                            key={a.address.toString()}
                            onClick={() => setSelected(a.address.toString())}
                            className={`action-row ${active?.address.equals(a.address) ? "selected" : ""}`}
                          >
                            <div className={`action-icon kind-${a.kind}`}>
                              {a.kind === VOTE ? (
                                <FileText size={18} />
                              ) : a.kind === REDEMPTION ? (
                                <CheckCheck size={18} />
                              ) : (
                                <ArrowDownLeft size={18} />
                              )}
                            </div>
                            <div className="action-description">
                              <strong>{titleFor(a)}</strong>
                              <span>
                                Record date {clock(a.recordAt.toNumber())}
                              </span>
                            </div>
                            <div className="action-row-right">
                              <span
                                className={`status ${a.status === 2 ? "completed" : "pending"}`}
                              >
                                {a.status === 0
                                  ? "Scheduled"
                                  : a.status === 2
                                    ? "Completed"
                                    : a.kind === VOTE
                                      ? "Voting open"
                                      : "Ready to settle"}
                              </span>
                              <strong>
                                {a.kind === VOTE
                                  ? `${a.totalQuantity.toString()} votes`
                                  : dollars(a.totalDue)}
                              </strong>
                            </div>
                            <ArrowRight size={15} />
                          </button>
                        ))
                      )}
                    </div>
                    <div className="schedule-row">
                      <select
                        aria-label="New corporate action type"
                        value={actionKind}
                        onChange={(e) => setActionKind(Number(e.target.value))}
                      >
                        <option value={COUPON}>Next coupon payment</option>
                        <option value={VOTE}>Bondholder vote</option>
                        <option value={REDEMPTION}>Principal redemption</option>
                      </select>
                      <button
                        className="button secondary"
                        onClick={() => void createAction()}
                        disabled={
                          disabled ||
                          i!.phase > 0 ||
                          matured ||
                          (actionKind === COUPON &&
                            i!.couponsScheduled >= i!.periods) ||
                          (actionKind === REDEMPTION && i!.redemptionScheduled)
                        }
                      >
                        Schedule action <ArrowRight size={15} />
                      </button>
                    </div>
                    <p className="panel-footnote">
                      Contractual dates are immutable. Snapshots execute in
                      record-date order; the final coupon precedes principal
                      redemption.
                    </p>
                  </section>
                  <section className="panel detail-panel">
                    {active ? (
                      <>
                        <div className="panel-heading">
                          <div>
                            <span className="tiny-label">ACTION DETAIL</span>
                            <h2>{titleFor(active)}</h2>
                          </div>
                          <a
                            className="icon-button"
                            href={explorer(
                              active.address.toString(),
                              session.rpc,
                              "address",
                            )}
                            target="_blank"
                            rel="noreferrer"
                            aria-label="Open action account"
                          >
                            <ExternalLink size={17} />
                          </a>
                        </div>
                        <div className="steps">
                          {[
                            "Scheduled",
                            "Recorded",
                            active.kind === VOTE ? "Voted" : "Settled",
                          ].map((step, idx) => (
                            <div
                              key={step}
                              className={active.status >= idx ? "done" : ""}
                            >
                              <span>
                                {active.status > idx ? (
                                  <Check size={12} />
                                ) : (
                                  idx + 1
                                )}
                              </span>
                              {step}
                            </div>
                          ))}
                        </div>
                        <div className="detail-fields">
                          <div>
                            <span>Record date</span>
                            <strong>{clock(active.recordAt.toNumber())}</strong>
                          </div>
                          <div>
                            <span>
                              {active.status === 0
                                ? "Until record date"
                                : "Snapshot slot"}
                            </span>
                            <strong className="mono">
                              {active.status === 0
                                ? `${Math.max(0, active.recordAt.toNumber() - chainNow)}s`
                                : active.snapshotSlot.toString()}
                            </strong>
                          </div>
                          {active.kind !== VOTE && (
                            <>
                              <div>
                                <span>Total entitlement</span>
                                <strong>{dollars(active.totalDue)}</strong>
                              </div>
                              <div>
                                <span>Available in action vault</span>
                                <strong>{dollars(active.funded)}</strong>
                              </div>
                            </>
                          )}
                          {active.kind === VOTE && (
                            <>
                              <div>
                                <span>Voting closes</span>
                                <strong>
                                  {clock(active.closeAt.toNumber())}
                                </strong>
                              </div>
                              <div>
                                <span>Votes for / against</span>
                                <strong>
                                  {active.yesWeight.toString()} /{" "}
                                  {active.noWeight.toString()}
                                </strong>
                              </div>
                            </>
                          )}
                        </div>
                        {active.kind === VOTE && (
                          <p className="proposal">
                            {active.proposal}
                            <small>
                              Quorum ≥ 50% · strict majority of votes cast
                            </small>
                          </p>
                        )}
                        {active.kind !== VOTE && (
                          <div className="settlement-progress">
                            <div>
                              <span>Settlement progress</span>
                              <strong>
                                {active.totalDue.isZero()
                                  ? "0"
                                  : Math.round(
                                      (active.totalPaid.toNumber() /
                                        active.totalDue.toNumber()) *
                                        100,
                                    )}
                                %
                              </strong>
                            </div>
                            <div className="progress-track">
                              <i
                                style={{
                                  width: `${active.totalDue.isZero() ? 0 : (active.totalPaid.toNumber() / active.totalDue.toNumber()) * 100}%`,
                                }}
                              />
                            </div>
                            <small>
                              {dollars(active.totalPaid)} paid ·{" "}
                              {dollars(
                                BigInt(active.totalDue.toString()) -
                                  BigInt(active.totalPaid.toString()),
                              )}{" "}
                              remaining
                            </small>
                          </div>
                        )}
                        <div className="detail-buttons">
                          {active.status === 0 && (
                            <button
                              className="button primary"
                              disabled={
                                disabled ||
                                chainNow < active.recordAt.toNumber() ||
                                !pending?.address.equals(active.address)
                              }
                              onClick={() =>
                                void run("Record immutable snapshot", () =>
                                  snapshot(session, active.address),
                                )
                              }
                            >
                              <LockKeyhole size={15} />
                              Record snapshot
                            </button>
                          )}
                          {active.status === 1 && active.kind !== VOTE && (
                            <>
                              <button
                                className="button primary"
                                disabled={
                                  disabled ||
                                  active.funded >=
                                    BigInt(active.totalDue.toString()) -
                                      BigInt(active.totalPaid.toString())
                                }
                                onClick={() =>
                                  void run("Fund action vault", () =>
                                    fund(
                                      session,
                                      active.address,
                                      BigInt(active.totalDue.toString()) -
                                        BigInt(active.totalPaid.toString()) -
                                        active.funded,
                                    ),
                                  )
                                }
                              >
                                <Wallet size={15} />
                                Fund obligation
                              </button>
                              <div className="button-pair">
                                <button
                                  className="button secondary"
                                  disabled={disabled}
                                  onClick={() => void processAll(active, true)}
                                >
                                  Pay one holder
                                </button>
                                <button
                                  className="button secondary"
                                  disabled={disabled}
                                  onClick={() => void processAll(active)}
                                >
                                  Resume all <ArrowRight size={14} />
                                </button>
                              </div>
                            </>
                          )}
                          {active.status === 1 && active.kind === VOTE && (
                            <>
                              <button
                                className="button secondary"
                                onClick={() => setView("investors")}
                              >
                                Open investor ballots <ArrowRight size={15} />
                              </button>
                              <button
                                className="button primary"
                                disabled={
                                  disabled ||
                                  chainNow < active.closeAt.toNumber()
                                }
                                onClick={() =>
                                  void run("Finalize vote", () =>
                                    finalizeVote(session, active.address),
                                  )
                                }
                              >
                                Finalize result <Check size={15} />
                              </button>
                            </>
                          )}
                          {active.status === 2 &&
                            active.kind !== VOTE &&
                            active.funded > 0n && (
                              <button
                                className="button secondary"
                                disabled={disabled}
                                onClick={() =>
                                  void run("Reclaim excess funding", () =>
                                    reclaimExcess(session, active.address),
                                  )
                                }
                              >
                                Reclaim excess funding
                              </button>
                            )}
                          {active.status === 2 && (
                            <div className="completed-note">
                              <ShieldCheck size={20} />
                              <div>
                                <strong>
                                  {active.kind === VOTE
                                    ? active.passed
                                      ? "Proposal passed"
                                      : "Proposal did not pass"
                                    : "All entitlements settled"}
                                </strong>
                                <span>
                                  {active.kind === REDEMPTION
                                    ? `${active.burnedQuantity.toString()} bond tokens burned on-chain`
                                    : active.kind === VOTE
                                      ? `Quorum ${active.quorumMet ? "met" : "not met"} · immutable voting result`
                                      : "Recorded and independently verifiable"}
                                </span>
                              </div>
                            </div>
                          )}
                        </div>
                      </>
                    ) : (
                      <div className="empty-small">
                        Select an action to inspect its lifecycle.
                      </div>
                    )}
                  </section>
                </div>
              )}

              {(view === "investors" || view === "overview") && (
                <section className="panel registry-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Holder registry</h2>
                      <p>
                        Current balances change. Recorded rights stay fixed.
                      </p>
                    </div>
                    <span className="status completed">
                      <ShieldCheck size={12} />
                      {i!.holders.length} / 32 holders
                    </span>
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>INVESTOR</th>
                          <th>CURRENT BONDS</th>
                          <th>
                            {active
                              ? `${titleFor(active).toUpperCase()} · RECORD`
                              : "RECORDED BONDS"}
                          </th>
                          <th>DEMOUSD RECEIVED</th>
                          <th>
                            {active?.kind === VOTE ? "BALLOT" : "ENTITLEMENT"}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {i!.holders.map((h, index) => {
                          const e = active?.entries.find((e) =>
                            e.owner.equals(h.owner),
                          );
                          const n = session.investors.findIndex((k) =>
                            k.publicKey.equals(h.owner),
                          );
                          const canVote =
                            active?.kind === VOTE &&
                            active.status === 1 &&
                            e &&
                            !e.voted &&
                            e.quantity.gtn(0) &&
                            chainNow < active.closeAt.toNumber() &&
                            n >= 0;
                          return (
                            <tr key={h.owner.toString()}>
                              <td>
                                <div className="holder-cell">
                                  <div
                                    className={`avatar investor-${index % 3}`}
                                  >
                                    {initials[n] || "IV"}
                                  </div>
                                  <div>
                                    <strong>{names(h.owner, session)}</strong>
                                    <a
                                      href={explorer(
                                        h.owner.toString(),
                                        session.rpc,
                                        "address",
                                      )}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="mono"
                                    >
                                      {shortAddress(h.owner)}{" "}
                                      <ArrowUpRight size={11} />
                                    </a>
                                  </div>
                                </div>
                              </td>
                              <td className="numeric">
                                {h.quantity.toString()}
                              </td>
                              <td className="numeric">
                                {e ? e.quantity.toString() : "—"}
                              </td>
                              <td className="numeric">
                                {n >= 0 ? dollars(state.cash[n]) : "—"}
                              </td>
                              <td>
                                {canVote ? (
                                  <div className="vote-buttons">
                                    <button
                                      disabled={disabled}
                                      onClick={() =>
                                        void run(
                                          `Vote FOR · ${people[n]}`,
                                          () =>
                                            vote(
                                              session,
                                              active!.address,
                                              active!.entries.indexOf(e!),
                                              n,
                                              true,
                                            ),
                                        )
                                      }
                                    >
                                      For
                                    </button>
                                    <button
                                      disabled={disabled}
                                      onClick={() =>
                                        void run(
                                          `Vote AGAINST · ${people[n]}`,
                                          () =>
                                            vote(
                                              session,
                                              active!.address,
                                              active!.entries.indexOf(e!),
                                              n,
                                              false,
                                            ),
                                        )
                                      }
                                    >
                                      Against
                                    </button>
                                  </div>
                                ) : active?.kind === VOTE ? (
                                  <span
                                    className={`status ${e?.voted ? "completed" : ""}`}
                                  >
                                    {e?.voted
                                      ? e.support
                                        ? "Voted for"
                                        : "Voted against"
                                      : "No ballot"}
                                  </span>
                                ) : e ? (
                                  <div className="entitlement-cell">
                                    <strong>{dollars(e.amount)}</strong>
                                    <span
                                      className={`status ${e.paid ? "completed" : "pending"}`}
                                    >
                                      {e.paid ? "Paid" : "Due"}
                                    </span>
                                  </div>
                                ) : (
                                  "—"
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="registry-footer">
                    <div>
                      <LockKeyhole size={15} />
                      <span>
                        Positions are held in program custody. Transfers require
                        the recorded owner's signature.
                      </span>
                    </div>
                    <span className="mono">
                      SUPPLY {state.supply.toString()} / VAULT{" "}
                      {state.custody.toString()}
                    </span>
                  </div>
                  {view === "investors" && (
                    <div className="transfer-demo">
                      <div>
                        <strong>
                          Demonstrate a transfer after the record date
                        </strong>
                        <p>
                          Aida transfers 4 bonds to Timur. The selected action
                          keeps its original snapshot.
                        </p>
                      </div>
                      <button
                        className="button secondary"
                        disabled={
                          disabled ||
                          locked ||
                          i!.holders
                            .find((h) =>
                              h.owner.equals(session.investors[0].publicKey),
                            )!
                            .quantity.ltn(4)
                        }
                        onClick={() =>
                          void run("Transfer 4 bonds · Aida → Timur", () =>
                            transfer(
                              session,
                              0,
                              session.investors[1].publicKey,
                              4,
                            ),
                          )
                        }
                      >
                        Transfer 4 bonds <ArrowRight size={15} />
                      </button>
                    </div>
                  )}
                </section>
              )}

              {view === "actions" && active && active.entries.length > 0 && (
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Immutable entitlement register</h2>
                      <p>
                        Created by the Solana program at snapshot slot{" "}
                        {active.snapshotSlot.toString()}.
                      </p>
                    </div>
                    <span className="status completed">
                      <LockKeyhole size={12} />
                      Record fixed
                    </span>
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>BENEFICIARY</th>
                          <th>RECORDED BONDS</th>
                          <th>ENTITLEMENT</th>
                          <th>STATE</th>
                          <th>EXECUTION</th>
                        </tr>
                      </thead>
                      <tbody>
                        {active.entries.map((e, index) => (
                          <tr key={e.owner.toString()}>
                            <td>{names(e.owner, session)}</td>
                            <td className="numeric">{e.quantity.toString()}</td>
                            <td className="numeric">
                              {active.kind === VOTE
                                ? `${e.quantity.toString()} voting weight`
                                : dollars(e.amount)}
                            </td>
                            <td>
                              <span
                                className={`status ${(active.kind === VOTE ? e.voted : e.paid) ? "completed" : "pending"}`}
                              >
                                {active.kind === VOTE
                                  ? e.voted
                                    ? "Voted"
                                    : "Not voted"
                                  : e.paid
                                    ? "Paid"
                                    : "Due"}
                              </span>
                            </td>
                            <td>
                              {active.kind !== VOTE && !e.paid ? (
                                <button
                                  className="table-button"
                                  disabled={disabled}
                                  onClick={() =>
                                    void run(
                                      `Settle ${names(e.owner, session)}`,
                                      () =>
                                        settle(
                                          session,
                                          active.address,
                                          index,
                                          e.owner,
                                        ),
                                    )
                                  }
                                >
                                  Settle <ArrowRight size={13} />
                                </button>
                              ) : active.kind !== VOTE && e.paid ? (
                                <button
                                  className="table-button muted"
                                  disabled={disabled}
                                  onClick={() =>
                                    void run("Verify duplicate rejection", () =>
                                      settle(
                                        session,
                                        active.address,
                                        index,
                                        e.owner,
                                      ),
                                    )
                                  }
                                >
                                  Test duplicate <ShieldCheck size={13} />
                                </button>
                              ) : (
                                "—"
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              {view === "investors" && (
                <section className="panel investor-card">
                  <div>
                    <span className="tiny-label">INVESTOR PERSPECTIVE</span>
                    <h2>My recorded rights</h2>
                    <p>Inspect every action for a selected investor.</p>
                  </div>
                  <select
                    aria-label="Investor perspective"
                    value={investor}
                    onChange={(e) => setInvestor(Number(e.target.value))}
                  >
                    {people.map((name, n) => (
                      <option key={name} value={n}>
                        {name}
                      </option>
                    ))}
                  </select>
                  <div className="investor-rights">
                    {actions.map((a) => {
                      const e = a.entries.find((e) =>
                        e.owner.equals(session.investors[investor].publicKey),
                      );
                      return (
                        <button
                          key={a.address.toString()}
                          onClick={() => {
                            setSelected(a.address.toString());
                            setView("actions");
                          }}
                        >
                          <span>{titleFor(a)}</span>
                          <strong>
                            {e
                              ? a.kind === VOTE
                                ? `${e.quantity} votes`
                                : dollars(e.amount)
                              : "Awaiting snapshot"}
                          </strong>
                          <ArrowUpRight size={15} />
                        </button>
                      );
                    })}
                  </div>
                </section>
              )}

              {view === "audit" && (
                <>
                  <section className="panel reconciliation">
                    <div className="panel-heading">
                      <div>
                        <h2>Reconciliation</h2>
                        <p>
                          Read directly from program accounts and SPL Token
                          accounts.
                        </p>
                      </div>
                      <button
                        className="button secondary"
                        onClick={downloadAudit}
                      >
                        <Download size={15} />
                        Export evidence
                      </button>
                    </div>
                    <div className="reconcile-grid">
                      <div>
                        <ShieldCheck size={23} />
                        <strong>
                          {reconciled ? "Supply reconciles" : "Supply mismatch"}
                        </strong>
                        <p>
                          Registry {i!.outstanding.toString()} = custody{" "}
                          {state.custody.toString()} = mint supply{" "}
                          {state.supply.toString()}
                        </p>
                      </div>
                      <div>
                        <CheckCheck size={23} />
                        <strong>Obligations reconcile</strong>
                        <p>
                          {dollars(totalDue)} due = {dollars(totalPaid)} paid +{" "}
                          {dollars(totalDue - totalPaid)} remaining
                        </p>
                      </div>
                      <div>
                        <LockKeyhole size={23} />
                        <strong>
                          {i!.phase === 2
                            ? "Redemption complete"
                            : "Lifecycle in progress"}
                        </strong>
                        <p>
                          {actions
                            .filter((a) => a.kind === REDEMPTION)
                            .reduce(
                              (sum, a) => sum + a.burnedQuantity.toNumber(),
                              0,
                            )}{" "}
                          tokens retired through atomic payment and burn
                        </p>
                      </div>
                    </div>
                  </section>
                  <section className="panel">
                    <div className="panel-heading">
                      <div>
                        <h2>On-chain action accounts</h2>
                        <p>
                          These records survive executor restarts and browser
                          resets.
                        </p>
                      </div>
                    </div>
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>ACTION</th>
                            <th>ACCOUNT</th>
                            <th>SNAPSHOT SLOT</th>
                            <th>RESULT</th>
                          </tr>
                        </thead>
                        <tbody>
                          {actions.map((a) => (
                            <tr key={a.address.toString()}>
                              <td>{titleFor(a)}</td>
                              <td>
                                <a
                                  href={explorer(
                                    a.address.toString(),
                                    session.rpc,
                                    "address",
                                  )}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="mono"
                                >
                                  {shortAddress(a.address)}{" "}
                                  <ExternalLink size={12} />
                                </a>
                              </td>
                              <td className="numeric">
                                {a.snapshotSlot.isZero()
                                  ? "Pending"
                                  : a.snapshotSlot.toString()}
                              </td>
                              <td>
                                {a.kind === VOTE
                                  ? a.status === 2
                                    ? a.passed
                                      ? "Passed"
                                      : "Not passed"
                                    : "Pending"
                                  : `${dollars(a.totalPaid)} / ${dollars(a.totalDue)}`}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                </>
              )}

              {(view === "audit" || view === "overview") && (
                <section className="panel activity-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Recent activity</h2>
                      <p>Confirmed transactions from this demo session.</p>
                    </div>
                    <span className="count-badge">{receipts.length}</span>
                  </div>
                  {receipts.slice(0, view === "audit" ? 100 : 5).map((r) => (
                    <div className="activity-row" key={r.signature}>
                      <div className="activity-check">
                        <Check size={14} />
                      </div>
                      <div>
                        <strong>{r.label}</strong>
                        <span>
                          {new Date(r.at).toLocaleTimeString()} · confirmed
                        </span>
                      </div>
                      <a
                        href={explorer(r.signature, session.rpc)}
                        target="_blank"
                        rel="noreferrer"
                        className="mono"
                      >
                        {shortAddress(r.signature)}
                        <ArrowUpRight size={14} />
                      </a>
                    </div>
                  ))}
                </section>
              )}
            </>
          )}
          <footer className="page-footer">
            <span>
              BondOps <span className="divider">/</span> Corporate action
              infrastructure
            </span>
            <span>
              Solana prototype <span className="footer-dot">·</span> KASE ×
              Superteam Kazakhstan challenge
            </span>
          </footer>
        </div>
      </main>
    </div>
  );
}

function Metric({
  label,
  value,
  note,
  green = false,
}: {
  label: string;
  value: string;
  note: string;
  green?: boolean;
}) {
  return (
    <div className={`metric ${green ? "green" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}
