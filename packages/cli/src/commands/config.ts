// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { Command } from 'commander';
import { loadConfigFile } from '../config.js';

export function configCommand(): Command {
  return new Command('config')
    .description('Show configuration')
    .command('show')
    .action(() => {
      const config = loadConfigFile();
      if (Object.keys(config).length === 0) {
        console.log('No .crmy.json found. Run `crmy init` to create one.');
        return;
      }
      // Redact sensitive values
      const display = {
        ...config,
        apiKey: config.apiKey ? config.apiKey.slice(0, 10) + '...' : undefined,
        jwtSecret: config.jwtSecret ? '***' : undefined,
      };
      console.log(JSON.stringify(display, null, 2));
    });
}
