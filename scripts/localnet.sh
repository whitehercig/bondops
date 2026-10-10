#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ ! -f target/deploy/bondops.so ]]; then npm run program:build; fi
mkdir -p .local
# This ledger belongs only to BondOps. Never reset another validator's ledger.
exec solana-test-validator --reset --ledger .local/ledger \
  --bpf-program "$(solana-keygen pubkey target/deploy/bondops-keypair.json)" target/deploy/bondops.so \
  --rpc-port 18999 --faucet-port 19900 --gossip-port 12000 --dynamic-port-range 12001-12030 --bind-address 127.0.0.1
