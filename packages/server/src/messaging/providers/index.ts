// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import type { ChannelProvider } from '../provider.js';
import { slackProvider } from './slack.js';

const providers = new Map<string, ChannelProvider>();

// Register built-in providers
providers.set(slackProvider.type, slackProvider);

/** Register a channel provider. Plugins can call this to add new providers. */
export function registerProvider(provider: ChannelProvider): void {
  providers.set(provider.type, provider);
}

/** Look up a registered channel provider by type. */
export function getProvider(type: string): ChannelProvider | undefined {
  return providers.get(type);
}

/** List all registered provider type names. */
export function listProviderTypes(): string[] {
  return Array.from(providers.keys());
}
