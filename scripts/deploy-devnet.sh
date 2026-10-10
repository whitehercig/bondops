#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .local
if [[ ! -f .local/devnet-operator.json ]]; then
  solana-keygen new --no-bip39-passphrase --silent --outfile .local/devnet-operator.json
fi
npm run program:build
solana balance --url devnet --keypair .local/devnet-operator.json
solana program deploy --url devnet --keypair .local/devnet-operator.json \
  --program-id target/deploy/bondops-keypair.json target/deploy/bondops.so
