// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { Command } from 'commander';

const HELP_TEXT = `
  CRMy — The agent-first open source CRM

  Usage: crmy <command> [options]

  Setup & Auth
    init                Initialize crmy: configure database, run migrations, create user
    login               Sign in to a CRMy server (shortcut for crmy auth login)
    auth                Manage authentication (login, logout, whoami)
    config              View and update local configuration
    migrate             Run database migrations

  Server
    server              Start the CRMy server
    mcp                 Start the MCP stdio server for Claude Code

  CRM Data
    contacts            Manage contacts (list, get, create, update, delete)
    accounts            Manage accounts (list, get, create, update, delete)
    opps                Manage opportunities (list, get, create, update, delete)
    pipeline            View and manage the sales pipeline
    notes               Manage notes on CRM objects
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

  Options
    -V, --version       Output the version number
    -h, --help          Display help for a command

  Examples
    $ crmy init                     Set up a new CRMy instance
    $ crmy server                   Start the server on :3000
    $ crmy contacts list            List all contacts
    $ crmy opps create              Create a new opportunity
    $ crmy mcp                      Start MCP server for Claude Code

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
