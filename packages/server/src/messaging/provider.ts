// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

export interface ChannelProviderSendResult {
  success: boolean;
  provider_msg_id?: string;
  response_status?: number;
  response_body?: string;
  error?: string;
}

export interface ChannelProviderMessage {
  recipient?: string;
  subject?: string;
  body: string;
}

export interface ChannelProvider {
  /** Provider type identifier, e.g. 'slack', 'email', 'teams' */
  type: string;
  /** Validate that config has the required fields for this provider. */
  validateConfig(config: Record<string, unknown>): { valid: boolean; error?: string };
  /** Send a single message. Must not throw — return success:false on failure. */
  send(config: Record<string, unknown>, message: ChannelProviderMessage): Promise<ChannelProviderSendResult>;
}
