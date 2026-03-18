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

export const CRMY_DIR      = path.join(os.homedir(), '.crmy');
export const GLOBAL_CONFIG = path.join(CRMY_DIR, 'config.json');

const AUTH_FILE = path.join(CRMY_DIR, 'auth.json');

/**
 * Load config — lookup order:
 *   1. explicitPath (passed via --config flag)
 *   2. process.cwd()/.crmy.json  (project-level override)
 *   3. ~/.crmy/config.json       (global; written by `init`, always reachable)
 *
 * This means `npx @crmy/cli mcp` works from any directory (e.g. when Claude
 * Code spawns it) without requiring the user to be in the init directory.
 */
export function loadConfigFile(explicitPath?: string): CrmyConfig {
  // 1. Explicit path
  if (explicitPath) {
    try {
      return JSON.parse(fs.readFileSync(explicitPath, 'utf-8')) as CrmyConfig;
    } catch {
      return {};
    }
  }

  // 2. Project-local override
  const localPath = path.join(process.cwd(), '.crmy.json');
  if (fs.existsSync(localPath)) {
    try {
      return JSON.parse(fs.readFileSync(localPath, 'utf-8')) as CrmyConfig;
    } catch {
      // fall through to global
    }
  }

  // 3. Global config
  try {
    return JSON.parse(fs.readFileSync(GLOBAL_CONFIG, 'utf-8')) as CrmyConfig;
  } catch {
    return {};
  }
}

/**
 * Save config to both locations so it is always discoverable:
 *   - ~/.crmy/config.json      global; MCP command finds it from any cwd
 *   - process.cwd()/.crmy.json project-local copy (for multi-project setups)
 */
export function saveConfigFile(config: CrmyConfig): void {
  const json = JSON.stringify(config, null, 2) + '\n';

  // Global (mode 600 — contains secrets)
  fs.mkdirSync(CRMY_DIR, { recursive: true });
  fs.writeFileSync(GLOBAL_CONFIG, json, { mode: 0o600 });

  // Project-local
  const localPath = path.join(process.cwd(), '.crmy.json');
  fs.writeFileSync(localPath, json);
}

export function loadAuthState(): AuthState | null {
  try {
    const raw = fs.readFileSync(AUTH_FILE, 'utf-8');
    const state = JSON.parse(raw) as AuthState;
    if (state.expiresAt && new Date(state.expiresAt) < new Date()) {
      return null;
    }
    return state;
  } catch {
    return null;
  }
}

export function saveAuthState(state: AuthState): void {
  fs.mkdirSync(CRMY_DIR, { recursive: true });
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
