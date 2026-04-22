// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { Command } from 'commander';
import crypto from 'node:crypto';
import { loadConfigFile } from '../config.js';
import { createSpinner } from '../spinner.js';

export function resetPasswordCommand(): Command {
  return new Command('reset-password')
    .description('Reset a CRMy user password directly in the database')
    .option('-e, --email <email>', 'Email address of the user to update')
    .option('-p, --password <password>', 'New password (min 12 characters)')
    .action(async (opts) => {
      // ── Resolve database URL ───────────────────────────────────────────────
      const config = loadConfigFile() as Record<string, unknown> & { database?: { url?: string } };
      const databaseUrl = config.database?.url ?? process.env.DATABASE_URL;

      if (!databaseUrl) {
        console.error(
          '\n  Error: No database URL found.\n\n' +
          '  Either run `crmy init` first or set DATABASE_URL in your environment.\n',
        );
        process.exit(1);
      }

      // ── Collect email interactively if not provided ────────────────────────
      let email: string = opts.email ?? '';
      let newPassword: string = opts.password ?? '';

      const { default: inquirer } = await import('inquirer');

      if (!email) {
        const answer = await inquirer.prompt([{
          type: 'input',
          name: 'email',
          message: 'User email:',
          validate: (v: string) =>
            /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) ? true : 'Enter a valid email address',
        }]);
        email = answer.email;
      }

      if (!newPassword) {
        const answer = await inquirer.prompt([
          {
            type: 'password',
            name: 'password',
            message: 'New password (min 12 chars):',
            mask: '*',
            validate: (v: string) =>
              v.length >= 12 ? true : 'Password must be at least 12 characters',
          },
          {
            type: 'password',
            name: 'confirm',
            message: 'Confirm new password:',
            mask: '*',
            validate: (v: string, a?: { password?: string }) =>
              v === a?.password ? true : 'Passwords do not match',
          },
        ]);
        newPassword = answer.password;
      }

      if (newPassword.length < 12) {
        console.error('\n  Error: Password must be at least 12 characters.\n');
        process.exit(1);
      }

      // ── Hash with scrypt (same params as init + auth/routes.ts) ───────────
      const spinner = createSpinner('Resetting password…');

      try {
        const pg = await import('pg');
        const { Pool } = pg.default ?? pg;
        const pool = new Pool({ connectionString: databaseUrl });

        // Look up all users with this email (may span multiple tenants)
        const userRes = await pool.query(
          `SELECT id, email, name, role FROM users WHERE LOWER(email) = LOWER($1)`,
          [email.trim()],
        );

        if (userRes.rows.length === 0) {
          spinner.fail(`No user found with email "${email}"`);
          await pool.end();
          process.exit(1);
        }

        // Hash the new password once and apply to every matching account
        const salt = crypto.randomBytes(16);
        const hash = crypto.scryptSync(newPassword, salt, 64, { N: 16384, r: 8, p: 1 });
        const passwordHash = `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`;

        await pool.query(
          `UPDATE users SET password_hash = $1 WHERE LOWER(email) = LOWER($2)`,
          [passwordHash, email.trim()],
        );

        await pool.end();

        const names = (userRes.rows as { id: string; email: string; name: string; role: string }[])
          .map(u => `${u.name ?? u.email} (${u.role})`)
          .join(', ');
        spinner.succeed(`Password reset for ${names}${userRes.rows.length > 1 ? ` — ${userRes.rows.length} accounts updated` : ''}`);
        console.log('');
      } catch (err) {
        spinner.fail('Failed to reset password');
        console.error(`\n  Error: ${(err as Error).message}\n`);
        process.exit(1);
      }
    });
}
