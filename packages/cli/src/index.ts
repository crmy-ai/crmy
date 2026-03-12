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

const program = new Command();

program
  .name('crmy')
  .description('CRMy — The agent-first open source CRM')
  .version('0.2.0');

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

program.parse();
