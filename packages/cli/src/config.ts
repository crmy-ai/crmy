// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export interface CrmyConfig {
  serverUrl?: string;
  apiKey?: string;
  tenantId?: string;
  database?: { url?: string };
  jwtSecret?: string;
  hitl?: { requireApproval?: string[]; autoApproveSeconds?: number };
}

export interface AuthState {
  serverUrl: string;
  token: string;
  user: { id: string; email: string; name: string; role: string; tenant_id: string };
  expiresAt?: string;
}

const AUTH_DIR = path.join(os.homedir(), '.crmy');
const AUTH_FILE = path.join(AUTH_DIR, 'auth.json');

export function loadConfigFile(): CrmyConfig {
  const configPath = path.join(process.cwd(), '.crmy.json');
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(raw) as CrmyConfig;
  } catch {
    return {};
  }
}

export function saveConfigFile(config: CrmyConfig): void {
  const configPath = path.join(process.cwd(), '.crmy.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
}

export function loadAuthState(): AuthState | null {
  try {
    const raw = fs.readFileSync(AUTH_FILE, 'utf-8');
    const state = JSON.parse(raw) as AuthState;
    // Check if token is expired
    if (state.expiresAt && new Date(state.expiresAt) < new Date()) {
      return null;
    }
    return state;
  } catch {
    return null;
  }
}

export function saveAuthState(state: AuthState): void {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  fs.writeFileSync(AUTH_FILE, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
}

export function clearAuthState(): void {
  try {
    fs.unlinkSync(AUTH_FILE);
  } catch {
    // ignore if doesn't exist
  }
}

/** Resolve the server URL from auth state, config, env, or default */
export function resolveServerUrl(): string | undefined {
  return process.env.CRMY_SERVER_URL
    ?? loadAuthState()?.serverUrl
    ?? loadConfigFile().serverUrl;
}
