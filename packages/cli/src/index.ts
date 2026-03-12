#!/usr/bin/env node
// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { serverCommand } from './commands/server.js';
import { mcpCommand } from './commands/mcp.js';
import { contactsCommand } from './commands/contacts.js';
import { accountsCommand } from './commands/accounts.js';
import { oppsCommand } from './commands/opps.js';
import { pipelineCommand } from './commands/pipeline.js';
import { searchCommand } from './commands/search.js';
import { hitlCommand } from './commands/hitl.js';
import { eventsCommand } from './commands/events.js';
import { configCommand } from './commands/config.js';
import { migrateCommand } from './commands/migrate.js';
import { useCasesCommand } from './commands/use-cases.js';
import { webhooksCommand } from './commands/webhooks.js';
import { emailsCommand } from './commands/emails.js';
import { customFieldsCommand } from './commands/custom-fields.js';
import { notesCommand } from './commands/notes.js';
import { workflowsCommand } from './commands/workflows.js';
import { authCommand } from './commands/auth.js';
import { helpCommand } from './commands/help.js';

const program = new Command();

program
  .name('crmy')
  .description('CRMy — The agent-first open source CRM')
  .version('0.3.0');

program.addCommand(authCommand());
program.addCommand(initCommand());
program.addCommand(serverCommand());
program.addCommand(mcpCommand());
program.addCommand(contactsCommand());
program.addCommand(accountsCommand());
program.addCommand(oppsCommand());
program.addCommand(pipelineCommand());
program.addCommand(searchCommand());
program.addCommand(hitlCommand());
program.addCommand(eventsCommand());
program.addCommand(configCommand());
program.addCommand(migrateCommand());
program.addCommand(useCasesCommand());
program.addCommand(webhooksCommand());
program.addCommand(emailsCommand());
program.addCommand(customFieldsCommand());
program.addCommand(notesCommand());
program.addCommand(workflowsCommand());
program.addCommand(helpCommand());

// Top-level `crmy login` shortcut (delegates to `crmy auth login`)
program.command('login')
  .description('Sign in to a CRMy server (shortcut for `crmy auth login`)')
  .option('-e, --email <email>', 'Email address')
  .option('-p, --password <password>', 'Password')
  .action(async (opts) => {
    // Re-run as `auth login` with same args
    const args = ['auth', 'login'];
    if (opts.email) args.push('-e', opts.email);
    if (opts.password) args.push('-p', opts.password);
    await program.parseAsync(['node', 'crmy', ...args]);
  });

program.parse();
