// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs';
import path from 'node:path';

export interface CrmyConfig {
  serverUrl?: string;
  apiKey?: string;
  tenantId?: string;
  database?: { url?: string };
  jwtSecret?: string;
  hitl?: { requireApproval?: string[]; autoApproveSeconds?: number };
}

export function loadConfigFile(): CrmyConfig {
  const configPath = path.join(process.cwd(), '.crmy.json');
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(raw) as CrmyConfig;
  } catch {
    return {};
  }
}
