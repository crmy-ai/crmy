// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const LOG_DIR  = path.join(os.homedir(), '.crmy');
export const LOG_FILE = path.join(LOG_DIR, 'crmy-server.log');

function ensureLogDir(): void {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

export function logToFile(line: string): void {
  try {
    ensureLogDir();
    const ts = new Date().toISOString();
    fs.appendFileSync(LOG_FILE, `[${ts}] ${line}\n`);
  } catch {
    // Never crash the server because logging failed
  }
}
