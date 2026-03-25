// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * In-process event bus for broadcasting CRM events to in-process subscribers
 * (e.g., MCP session registry). Does not replace the DB events table.
 */

import { EventEmitter } from 'node:events';
import type { EmitEventOpts } from './emitter.js';

export interface BusEvent extends EmitEventOpts {
  event_id: number;
}

class CrmyEventBus extends EventEmitter {
  emit(event: 'crmy:event', data: BusEvent): boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  emit(event: string, ...args: any[]): boolean {
    return super.emit(event, ...args);
  }

  on(event: 'crmy:event', listener: (data: BusEvent) => void): this;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }
}

export const eventBus = new CrmyEventBus();
eventBus.setMaxListeners(200);
