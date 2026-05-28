// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { Command } from 'commander';

const HELP_TEXT = `
  CRMy — operational customer context for AI agents

  Usage: crmy <command> [options]

  Setup & Auth
    init                Configure Postgres, run migrations, create owner, write config
    login               Sign in to a CRMy server (shortcut for crmy auth login)
    auth                Manage authentication (login, logout, whoami)
    config              View local/global CRMy configuration with secrets redacted
    migrate             Run database migrations

  Server
    server              Start the CRMy API, Web UI, and HTTP MCP endpoint
    mcp                 Start the local stdio MCP server for agent clients

  Customer State
    contacts            Manage contacts (list, get, create, update, delete)
    accounts            Manage accounts (list, get, create, update, delete)
    opps                Manage opportunities (list, get, create, update, delete)
    pipeline            View and manage the sales pipeline
    context             Manage Signals and Memory attached to customer records
    custom-fields       Manage custom field definitions
    search              Search across contacts, accounts, and opportunities

  Automation
    workflows           Manage automation workflows
    events              View the event log
    webhooks            Manage webhook subscriptions
    emails              Send and manage emails
    hitl                Human-in-the-loop approval queue

  Resources
    use-cases           Browse example use cases and templates
    briefing            Get record context before taking action
    seed-demo           Load demo customer data for a fast first run
    reset-password      Reset a local user's password through Postgres
    doctor              Check database, config, migrations, port, and secrets

  Options
    -V, --version       Output the version number
    -h, --help          Display help for a command

  Examples
    $ crmy init                     Set up a new CRMy instance
    $ crmy server                   Start the server on :3000
    $ crmy doctor                   Check setup health
    $ crmy briefing contact:<id>    Get customer context before action
    $ crmy contacts list            List all contacts
    $ crmy mcp                      Start stdio MCP for local agents

  Run crmy <command> --help for detailed usage of any command.
`;

export function helpCommand(): Command {
  return new Command('help')
    .description('Show detailed help and list all available commands')
    .argument('[command]', 'Show help for a specific command')
    .allowExcessArguments(true)
    .action(async (commandName, _opts, cmd) => {
      if (commandName) {
        // Delegate to the specific command's --help
        const root = cmd.parent;
        if (root) {
          const sub = root.commands.find(
            (c: Command) => c.name() === commandName,
          );
          if (sub) {
            sub.outputHelp();
            return;
          }
        }
        console.error(`  Unknown command: ${commandName}\n`);
        console.error(`  Run crmy help to see all available commands.`);
        process.exitCode = 1;
        return;
      }

      console.log(HELP_TEXT);
    });
}
