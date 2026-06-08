// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { Command } from 'commander';
import { loadConfigFile } from '../config.js';

function showConfig(): void {
  const config = loadConfigFile();
  if (Object.keys(config).length === 0) {
    console.log(
      'No CRMy config found.\n\n' +
      'Run `crmy init` to create one, or set DATABASE_URL / CRMY_SERVER_URL / CRMY_API_KEY in your environment.',
    );
    return;
  }
  // Redact sensitive values
  const display = {
    ...config,
    apiKey: config.apiKey ? config.apiKey.slice(0, 10) + '...' : undefined,
    jwtSecret: config.jwtSecret ? '***' : undefined,
    encryptionKey: config.encryptionKey ? '***' : undefined,
  };
  console.log(JSON.stringify(display, null, 2));
}

export function configCommand(): Command {
  const cmd = new Command('config')
    .description('Show local CRMy configuration')
    .action(showConfig);

  cmd
    .command('show')
    .description('Print the resolved CRMy config with secrets redacted')
    .action(showConfig);

  return cmd;
}
