import { readFileSync, writeFileSync } from 'node:fs';
const id = process.argv[2];
if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(id || '')) throw new Error('Expected program public key');
const rust = 'programs/bondops/src/lib.rs';
writeFileSync(rust, readFileSync(rust, 'utf8').replace(/declare_id!\("[^"]+"\)/, `declare_id!("${id}")`));
writeFileSync('Anchor.toml', readFileSync('Anchor.toml', 'utf8').replace(/bondops = "[^"]+"/g, `bondops = "${id}"`));
try {
  const file = 'app/src/idl.json';
  const idl = JSON.parse(readFileSync(file, 'utf8'));
  idl.address = id;
  writeFileSync(file, JSON.stringify(idl, null, 2) + '\n');
} catch (e) { if (e.code !== 'ENOENT') throw e; }
