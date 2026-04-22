#!/usr/bin/env node
// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

// ── Node.js version gate ─────────────────────────────────────────────────────
// Must run before any ESM-only imports that would produce cryptic errors on
// older runtimes. The engines field in package.json is advisory only.
const [_nodeMajor] = process.versions.node.split('.').map(Number);
if (_nodeMajor < 20) {
  console.error(
    `\n  CRMy requires Node.js >= 20.0.0 (you have ${process.version})` +
    `\n  Install the latest LTS: https://nodejs.org\n`,
  );
  process.exit(1);
}

import { Command } from 'commander';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { initCommand } from './commands/init.js';

const _require = createRequire(import.meta.url);
function getCLIVersion(): string {
  try {
    const pkg = _require(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../package.json'),
    ) as { version: string };
    return pkg.version;
  } catch {
    return 'unknown';
  }
}
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
import { actorsCommand } from './commands/actors.js';
import { assignmentsCommand } from './commands/assignments.js';
import { contextCommand } from './commands/context.js';
import { activityTypesCommand } from './commands/activity-types.js';
import { contextTypesCommand } from './commands/context-types.js';
import { briefingCommand } from './commands/briefing.js';
import { authCommand } from './commands/auth.js';
import { helpCommand } from './commands/help.js';
import { seedDemoCommand } from './commands/seed-demo.js';
import { resetPasswordCommand } from './commands/reset-password.js';
import { doctorCommand } from './commands/doctor.js';

const program = new Command();

program
  .name('crmy')
  .description('CRMy — The agent-first open source CRM')
  .version(getCLIVersion());

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
program.addCommand(actorsCommand());
program.addCommand(assignmentsCommand());
program.addCommand(contextCommand());
program.addCommand(activityTypesCommand());
program.addCommand(contextTypesCommand());
program.addCommand(briefingCommand());
program.addCommand(seedDemoCommand());
program.addCommand(resetPasswordCommand());
program.addCommand(doctorCommand());
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
