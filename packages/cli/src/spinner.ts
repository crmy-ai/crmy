// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export interface Spinner {
  update(message: string): void;
  succeed(message: string): void;
  fail(message: string): void;
  stop(): void;
}

export function createSpinner(initialMessage: string): Spinner {
  if (!process.stdout.isTTY) {
    // Non-TTY fallback: plain output for CI / piped logs
    if (initialMessage) console.log(`  ...  ${initialMessage}`);
    return {
      update(message: string) { if (message) console.log(`  ...  ${message}`); },
      succeed(message: string) { console.log(`  \x1b[32m\u2713\x1b[0m  ${message}`); },
      fail(message: string)   { console.log(`  \x1b[31m\u2717\x1b[0m  ${message}`); },
      stop()                  {},
    };
  }

  let frame = 0;
  let current = initialMessage;
  let stopped = false;

  const cols = () => process.stdout.columns ?? 80;

  const interval = setInterval(() => {
    if (stopped) return;
    const symbol = FRAMES[frame % FRAMES.length];
    const line = `  ${symbol}  ${current}`;
    process.stdout.write(`\r${line.padEnd(cols())}`);
    frame++;
  }, 80);

  const clearLine = () => {
    process.stdout.write(`\r${' '.repeat(cols())}\r`);
  };

  return {
    update(message: string) {
      current = message;
    },
    succeed(message: string) {
      stopped = true;
      clearInterval(interval);
      clearLine();
      console.log(`  \x1b[32m\u2713\x1b[0m  ${message}`);
    },
    fail(message: string) {
      stopped = true;
      clearInterval(interval);
      clearLine();
      console.log(`  \x1b[31m\u2717\x1b[0m  ${message}`);
    },
    stop() {
      stopped = true;
      clearInterval(interval);
      clearLine();
    },
  };
}
