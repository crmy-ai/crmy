// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { Command } from 'commander';
import { loadAuthState, saveAuthState, clearAuthState, resolveServerUrl } from '../config.js';

export function authCommand(): Command {
  const cmd = new Command('auth').description('Authenticate against a CRMy server');

  // crmy auth setup
  cmd.command('setup')
    .description('Configure the CRMy server URL')
    .argument('[url]', 'Server URL (e.g. http://localhost:3000)')
    .action(async (urlArg?: string) => {
      let serverUrl = urlArg;

      if (!serverUrl) {
        const { default: inquirer } = await import('inquirer');
        const answers = await inquirer.prompt([
          {
            type: 'input',
            name: 'serverUrl',
            message: 'CRMy server URL:',
            default: 'http://localhost:3000',
          },
        ]);
        serverUrl = answers.serverUrl;
      }

      // Validate the URL by hitting the health endpoint
      try {
        const res = await fetch(`${serverUrl!.replace(/\/$/, '')}/health`);
        if (!res.ok) {
          console.error(`Server at ${serverUrl} returned ${res.status}`);
          process.exit(1);
        }
        const data = await res.json() as { status: string; version: string };
        console.log(`\n  Connected to CRMy ${data.version} at ${serverUrl}\n`);
        console.log('  Run `crmy login` to authenticate.\n');

        // Save a partial auth state with just the server URL
        const existing = loadAuthState();
        if (existing) {
          saveAuthState({ ...existing, serverUrl: serverUrl! });
        } else {
          // Store server URL for login to pick up
          saveAuthState({
            serverUrl: serverUrl!,
            token: '',
            user: { id: '', email: '', name: '', role: '', tenant_id: '' },
          });
        }
      } catch (err) {
        console.error(`Could not connect to ${serverUrl}: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });

  // crmy login
  cmd.command('login')
    .description('Sign in with email and password')
    .option('-e, --email <email>', 'Email address')
    .option('-p, --password <password>', 'Password')
    .action(async (opts) => {
      const serverUrl = resolveServerUrl();
      if (!serverUrl) {
        console.error('No server configured. Run `crmy auth setup` first.');
        process.exit(1);
      }

      let email = opts.email;
      let password = opts.password;

      if (!email || !password) {
        const { default: inquirer } = await import('inquirer');
        const answers = await inquirer.prompt([
          ...(email ? [] : [{ type: 'input', name: 'email', message: 'Email:' }]),
          ...(password ? [] : [{ type: 'password', name: 'password', message: 'Password:', mask: '*' }]),
        ]);
        email = email ?? answers.email;
        password = password ?? answers.password;
      }

      try {
        const res = await fetch(`${serverUrl.replace(/\/$/, '')}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({ detail: res.statusText })) as { detail?: string };
          console.error(`Login failed: ${body.detail ?? res.statusText}`);
          process.exit(1);
        }

        const data = await res.json() as {
          token: string;
          user: { id: string; email: string; name: string; role: string; tenant_id: string };
        };

        // Decode JWT to get expiration
        const payloadB64 = data.token.split('.')[1];
        const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
        const expiresAt = payload.exp ? new Date(payload.exp * 1000).toISOString() : undefined;

        saveAuthState({
          serverUrl,
          token: data.token,
          user: data.user,
          expiresAt,
        });

        console.log(`\n  Logged in as ${data.user.name} (${data.user.email})`);
        console.log(`  Role: ${data.user.role}`);
        if (expiresAt) {
          console.log(`  Token expires: ${new Date(expiresAt).toLocaleString()}`);
        }
        console.log();
      } catch (err) {
        console.error(`Login failed: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });

  // crmy auth status
  cmd.command('status')
    .description('Show current authentication status')
    .action(() => {
      const auth = loadAuthState();
      if (!auth || !auth.token) {
        console.log('\n  Not authenticated. Run `crmy login` to sign in.\n');
        return;
      }

      console.log(`\n  Server:  ${auth.serverUrl}`);
      console.log(`  User:    ${auth.user.name} (${auth.user.email})`);
      console.log(`  Role:    ${auth.user.role}`);
      if (auth.expiresAt) {
        const expires = new Date(auth.expiresAt);
        const remaining = expires.getTime() - Date.now();
        if (remaining <= 0) {
          console.log('  Token:   Expired — run `crmy login` to re-authenticate');
        } else {
          const mins = Math.floor(remaining / 60000);
          console.log(`  Token:   Valid (${mins}m remaining)`);
        }
      }
      console.log();
    });

  // crmy auth logout
  cmd.command('logout')
    .description('Clear stored credentials')
    .action(() => {
      clearAuthState();
      console.log('\n  Logged out. Credentials cleared.\n');
    });

  return cmd;
}
