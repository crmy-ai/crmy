// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Router } from 'express';
import type { CrmyEvent } from '@crmy/shared';

export interface CrmyPlugin {
  name: string;
  onEvent?: (event: CrmyEvent) => Promise<void>;
  registerTools?: (server: McpServer) => void;
  registerRoutes?: (router: Router) => void;
}

// v0.1: empty array. v0.2+: plugins loaded from config
export const plugins: CrmyPlugin[] = [];
