// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Router } from 'express';
import type { CrmyEvent } from '@crmy/shared';
import type { DbPool } from '../db/pool.js';

export interface CrmyPlugin {
  name: string;
  version?: string;
  onInit?: (ctx: PluginContext) => Promise<void>;
  onEvent?: (event: CrmyEvent) => Promise<void>;
  registerTools?: (server: McpServer) => void;
  registerRoutes?: (router: Router) => void;
  onShutdown?: () => Promise<void>;
}

export interface PluginContext {
  db: DbPool;
  config: Record<string, unknown>;
}

const loadedPlugins: CrmyPlugin[] = [];

export function getPlugins(): CrmyPlugin[] {
  return loadedPlugins;
}

export async function loadPlugins(
  pluginConfigs: PluginConfig[],
  ctx: PluginContext,
): Promise<void> {
  for (const config of pluginConfigs) {
    try {
      const mod = await import(config.module);
      const plugin: CrmyPlugin = typeof mod.default === 'function'
        ? mod.default(config.options ?? {})
        : mod.default;

      if (plugin.onInit) {
        await plugin.onInit(ctx);
      }
      loadedPlugins.push(plugin);
      console.log(`Plugin loaded: ${plugin.name}${plugin.version ? ` v${plugin.version}` : ''}`);
    } catch (err) {
      console.error(`Failed to load plugin "${config.module}":`, err);
    }
  }
}

export async function dispatchEvent(event: CrmyEvent): Promise<void> {
  for (const plugin of loadedPlugins) {
    if (plugin.onEvent) {
      try {
        await plugin.onEvent(event);
      } catch (err) {
        console.error(`Plugin "${plugin.name}" onEvent error:`, err);
      }
    }
  }
}

export async function shutdownPlugins(): Promise<void> {
  for (const plugin of loadedPlugins) {
    if (plugin.onShutdown) {
      try {
        await plugin.onShutdown();
      } catch (err) {
        console.error(`Plugin "${plugin.name}" shutdown error:`, err);
      }
    }
  }
  loadedPlugins.length = 0;
}

export interface PluginConfig {
  module: string;
  options?: Record<string, unknown>;
}
