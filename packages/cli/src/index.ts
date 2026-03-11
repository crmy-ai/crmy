#!/usr/bin/env node
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

const program = new Command();

program
  .name('crmy-ai')
  .description('crmy.ai — The agent-first open source CRM')
  .version('0.1.0');

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

program.parse();
