// Loads .env file into process.env if it exists. Silent no-op if missing.
// Used by the dev script so `npm run dev` works with or without a .env file.
//
// Checks three locations (first found wins):
//   1. packages/server/.env  (cwd when npm runs the workspace script)
//   2. repo root .env        (two levels up from packages/server/)
//   3. actual process.cwd()  (fallback)
const { readFileSync, existsSync } = require('fs');
const { resolve } = require('path');

const candidates = [
  resolve(process.cwd(), '.env'),                // packages/server/.env
  resolve(process.cwd(), '../../.env'),           // repo root .env
  resolve(__dirname, '../../../.env'),             // repo root relative to this script
];

const envPath = candidates.find(p => existsSync(p));
if (!envPath) return;

for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eq = trimmed.indexOf('=');
  if (eq === -1) continue;
  const key = trimmed.slice(0, eq).trim();
  let val = trimmed.slice(eq + 1).trim();
  // Strip surrounding quotes
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1);
  }
  if (!(key in process.env)) {
    process.env[key] = val;
  }
}
