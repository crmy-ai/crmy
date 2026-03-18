// Copies the web UI build into packages/server/public/ so it ships
// inside the @crmy/server npm tarball as a self-contained asset.
// Uses .cjs extension so Node treats it as CommonJS even though the
// server package is "type": "module".
const { cpSync, mkdirSync, existsSync, rmSync } = require('fs');
const path = require('path');

const src  = path.resolve(__dirname, '../../web/dist');
const dest = path.resolve(__dirname, '../public');

if (!existsSync(src)) {
  console.warn('copy-web: ../web/dist not found — skipping (run `npm run build` in packages/web first)');
  process.exit(0);
}

// Clean previous copy so stale files don't accumulate
if (existsSync(dest)) {
  rmSync(dest, { recursive: true, force: true });
}
mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log('copy-web: web UI assets copied to server/public/');
