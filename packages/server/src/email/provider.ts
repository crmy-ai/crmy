// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

export interface EmailSendResult {
  success: boolean;
  provider_msg_id?: string;
  error?: string;
}

export interface EmailMessage {
  from_name: string;
  from_email: string;
  to_email: string;
  to_name?: string;
  subject: string;
  body_html?: string;
  body_text: string;
}

export interface EmailProvider {
  /** Provider type identifier, e.g. 'smtp' */
  type: string;
  /** Validate that config has the required fields for this provider. */
  validateConfig(config: Record<string, unknown>): { valid: boolean; error?: string };
  /** Send a single email. Must not throw — return success:false on failure. */
  send(config: Record<string, unknown>, message: EmailMessage): Promise<EmailSendResult>;
}
