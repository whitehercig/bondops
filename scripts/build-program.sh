#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p target/deploy
if [[ ! -f target/deploy/bondops-keypair.json ]]; then
  if [[ -f ../../work/bondops-program-keypair.json ]]; then
    cp ../../work/bondops-program-keypair.json target/deploy/bondops-keypair.json
  else
    solana-keygen new --no-bip39-passphrase --silent --outfile target/deploy/bondops-keypair.json
  fi
fi
program_id="$(solana-keygen pubkey target/deploy/bondops-keypair.json)"
node scripts/set-program-id.mjs "$program_id"
cargo build-sbf --tools-version v1.57 --manifest-path programs/bondops/Cargo.toml
(cd programs/bondops && anchor idl build --out ../../app/src/idl.json)
node scripts/set-program-id.mjs "$program_id"
