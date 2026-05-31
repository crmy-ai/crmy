// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

const { spawnSync } = require('node:child_process');

const useAppDatabase = process.argv.includes('--use-app-database');

if (!process.env.CRMY_INTEGRATION_DATABASE_URL && !process.env.TEST_DATABASE_URL && useAppDatabase) {
  if (!process.env.DATABASE_URL) {
    console.error('[integration] --use-app-database was set, but DATABASE_URL is not configured.');
    process.exit(1);
  }
  process.env.TEST_DATABASE_URL = process.env.DATABASE_URL;
  process.env.CRMY_INTEGRATION_DATABASE_SOURCE = 'DATABASE_URL';
}

const result = spawnSync(process.execPath, ['--test', 'test/integration-durability.test.mjs'], {
  stdio: 'inherit',
  env: process.env,
});

process.exit(result.status ?? 1);
