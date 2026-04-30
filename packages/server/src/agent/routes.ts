// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { Router, type Request, type Response } from 'express';
import type { DbPool } from '../db/pool.js';
import type { ActorContext } from '@crmy/shared';
import { CrmyError, permissionDenied } from '@crmy/shared';
import * as agentRepo from '../db/repos/agent.js';
import * as activityRepo from '../db/repos/agent-activity.js';
import { encrypt, decrypt } from './crypto.js';
import { runAgentTurn } from './engine.js';
import { trimForPersistence, estimateHistoryChars } from './compaction.js';
import type { AgentEvent, ConversationMessage } from './types.js';

function getActor(req: Request): ActorContext {
  return req.actor!;
}

function handleError(res: Response, err: unknown): void {
  if (err instanceof CrmyError) {
    res.status(err.status).json(err.toJSON());
    return;
  }
  const message = err instanceof Error ? err.message : 'Internal error';
  res.status(500).json({ type: 'https://crmy.ai/errors/internal', title: 'Internal Error', status: 500, detail: message });
}

function requireAdmin(actor: ActorContext): void {
  if (actor.role !== 'owner' && actor.role !== 'admin') {
    throw permissionDenied('Admin role required');
  }
}

/**
 * Build safe key metadata for the client response.
 * Decrypts the stored key only to extract the last 4 chars as a hint.
 * Never sends the full plaintext or the ciphertext to the client.
 */
function buildKeyMeta(apiKeyEnc: string | null): { api_key_configured: boolean; api_key_hint: string | null } {
  if (!apiKeyEnc) return { api_key_configured: false, api_key_hint: null };
  try {
    const plain = decrypt(apiKeyEnc);
    return { api_key_configured: true, api_key_hint: plain.slice(-4) };
  } catch {
    // Key exists but cannot be decrypted (wrong env key, corrupted data)
    return { api_key_configured: true, api_key_hint: null };
  }
}

export function agentRouter(db: DbPool): Router {
  const router = Router();

  // ── Config ──────────────────────────────────────────────────────────────

  /** GET /agent/config — get agent config for this tenant. */
  router.get('/config', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const config = await agentRepo.getConfig(db, actor.tenant_id);
      if (!config) {
        res.json({ data: null });
        return;
      }
      // Never return the ciphertext — send only a hint (last 4 chars)
      const { api_key_enc: _enc, ...rest } = config;
      res.json({ data: { ...rest, ...buildKeyMeta(_enc) } });
    } catch (err) { handleError(res, err); }
  });

  /** PUT /agent/config — create or update agent config (admin only). */
  router.put('/config', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      requireAdmin(actor);

      const body = req.body as Record<string, unknown>;
      const update: Record<string, unknown> = {};

      // Pick allowed fields
      const boolFields = ['enabled', 'can_write_objects', 'can_log_activities', 'can_create_assignments', 'auto_extract_context'];
      const strFields = ['provider', 'base_url', 'model', 'system_prompt'];
      const intFields = ['max_tokens_per_turn', 'history_retention_days'];

      for (const f of boolFields) {
        if (typeof body[f] === 'boolean') update[f] = body[f];
      }
      for (const f of strFields) {
        if (typeof body[f] === 'string') update[f] = body[f];
      }
      for (const f of intFields) {
        if (typeof body[f] === 'number') update[f] = body[f];
      }

      // Encrypt API key if a new one was provided (non-empty string)
      if (typeof body.api_key === 'string' && body.api_key.trim()) {
        update.api_key_enc = encrypt(body.api_key.trim());
      }

      const config = await agentRepo.upsertConfig(db, actor.tenant_id, update);
      const { api_key_enc: _enc2, ...rest2 } = config;
      res.json({ data: { ...rest2, ...buildKeyMeta(_enc2) } });
    } catch (err) { handleError(res, err); }
  });

  /** POST /agent/config/test — test LLM connection.
   *
   * Accepts optional body overrides so the UI can test *current form values*
   * before the user has saved. Falls back to the stored config for any field
   * not supplied. Works regardless of whether the agent is enabled.
   */
  router.post('/config/test', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      requireAdmin(actor);

      const config = await agentRepo.getConfig(db, actor.tenant_id);

      // Merge form values (not-yet-saved) over stored config
      const body = req.body as { provider?: string; base_url?: string; api_key?: string; model?: string };

      const provider = body.provider ?? config?.provider;
      const rawUrl   = body.base_url  ?? config?.base_url ?? '';
      const model    = body.model     ?? config?.model    ?? '';
      const baseUrl  = rawUrl.replace(/\/+$/, '');

      // If caller sent an api_key, use it directly (trimmed). Otherwise decrypt the stored one.
      let apiKey = '';
      if (typeof body.api_key === 'string' && body.api_key.trim()) {
        apiKey = body.api_key.trim();
      } else if (config?.api_key_enc) {
        apiKey = decrypt(config.api_key_enc).trim();
      }

      if (!provider || !baseUrl || !model) {
        res.json({ ok: false, error: 'Provider, base URL, and model are required' });
        return;
      }

      // Attempt a minimal LLM call
      if (provider === 'anthropic') {
        const testRes = await fetch(`${baseUrl}/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model,
            max_tokens: 10,
            messages: [{ role: 'user', content: 'Hi' }],
          }),
        });
        if (!testRes.ok) {
          const err = await testRes.text();
          res.json({ ok: false, error: `${testRes.status}: ${err.slice(0, 200)}` });
          return;
        }
      } else {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
        if (baseUrl.includes('openrouter.ai')) {
          headers['HTTP-Referer'] = 'https://github.com/crmy-dev/crmy';
          headers['X-Title'] = 'CRMy';
        }

        const testRes = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model,
            max_tokens: 10,
            messages: [{ role: 'user', content: 'Hi' }],
          }),
        });
        if (!testRes.ok) {
          const err = await testRes.text();
          res.json({ ok: false, error: `${testRes.status}: ${err.slice(0, 200)}` });
          return;
        }
      }

      res.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Connection failed';
      res.json({ ok: false, error: message });
    }
  });

  // ── Sessions ────────────────────────────────────────────────────────────

  /** GET /agent/sessions — list current user's sessions. */
  router.get('/sessions', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const sessions = await agentRepo.listSessions(db, actor.tenant_id, actor.actor_id);
      res.json({ data: sessions });
    } catch (err) { handleError(res, err); }
  });

  /** POST /agent/sessions — create a new session. */
  router.post('/sessions', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const body = req.body as { context_type?: string; context_id?: string; context_name?: string };
      const session = await agentRepo.createSession(db, actor.tenant_id, actor.actor_id, body);
      res.status(201).json({ data: session });
    } catch (err) { handleError(res, err); }
  });

  /** GET /agent/sessions/:id — get session with messages. */
  router.get('/sessions/:id', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const session = await agentRepo.getSession(db, actor.tenant_id, String(req.params.id));
      if (!session || session.user_id !== actor.actor_id) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }
      res.json({ data: session });
    } catch (err) { handleError(res, err); }
  });

  /** PATCH /agent/sessions/:id — rename a session (update label). */
  router.patch('/sessions/:id', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      const session = await agentRepo.getSession(db, actor.tenant_id, String(req.params.id));
      if (!session || session.user_id !== actor.actor_id) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }
      const { label } = req.body as { label?: string };
      const updated = await agentRepo.updateSession(db, actor.tenant_id, session.id, { label: label ?? undefined });
      res.json({ data: updated });
    } catch (err) { handleError(res, err); }
  });

  /** DELETE /agent/sessions/:id — delete a session. */
  router.delete('/sessions/:id', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      await agentRepo.deleteSession(db, actor.tenant_id, String(req.params.id));
      res.status(204).end();
    } catch (err) { handleError(res, err); }
  });

  /** DELETE /agent/sessions — clear all sessions for tenant (admin only). */
  router.delete('/sessions', async (req: Request, res: Response) => {
    try {
      const actor = getActor(req);
      requireAdmin(actor);
      const count = await agentRepo.deleteAllSessions(db, actor.tenant_id);
      res.json({ deleted: count });
    } catch (err) { handleError(res, err); }
  });

  /** POST /agent/sessions/:id/chat — send a message and stream the response via SSE. */
  router.post('/sessions/:id/chat', async (req: Request, res: Response) => {
    const actor = getActor(req);
    const { message, auto_greet } = req.body as { message?: string; auto_greet?: boolean };

    // auto_greet: the frontend sends this when a session is opened with entity context
    // and no user message yet. We inject an internal prompt to trigger briefing_get
    // and surface a real AI summary rather than a static greeting.
    const GREET_PROMPT =
      '[SYSTEM_INIT] The user has just opened this conversation from a CRM record. ' +
      'Call briefing_get for this record immediately. Then respond with a concise 2–3 sentence ' +
      'summary of the most important current facts — be specific (mention lifecycle stage, ' +
      'last activity, any notable context entries or open assignments). ' +
      'Do not ask what the user would like to do; just surface the key facts in a natural, helpful tone.';

    const effectiveMessage = auto_greet ? GREET_PROMPT : message;

    if (!effectiveMessage?.trim()) {
      res.status(400).json({ error: 'message is required' });
      return;
    }

    // Load config
    const config = await agentRepo.getConfig(db, actor.tenant_id);
    if (!config?.enabled) {
      res.status(400).json({ error: 'Agent is not enabled for this workspace' });
      return;
    }

    // Load or verify session
    let session = await agentRepo.getSession(db, actor.tenant_id, String(req.params.id));
    if (!session || session.user_id !== actor.actor_id) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    // Set up SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // disable nginx buffering
    });
    // Disable Nagle's algorithm so small SSE packets aren't delayed
    res.socket?.setNoDelay(true);
    // Flush headers immediately so the browser knows the stream has started
    res.flushHeaders();

    const sendEvent = (event: AgentEvent) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
      // If compression middleware is present it wraps the socket with flush()
      if (typeof (res as unknown as { flush?: () => void }).flush === 'function') {
        (res as unknown as { flush: () => void }).flush();
      }
    };

    try {
      // Build conversation history from session
      const history: ConversationMessage[] = [...(session.messages as ConversationMessage[])];

      // Add user message (or auto-greet internal prompt)
      history.push({ role: 'user', content: effectiveMessage });

      // Run the agent turn, injecting context metadata from the session so the
      // system prompt knows which record the conversation is about.
      const contextMeta = session.context_type
        ? { type: session.context_type, id: session.context_id ?? '', name: session.context_name ?? '', detail: undefined }
        : undefined;

      const updatedHistory = await runAgentTurn(history, config, actor, db, sendEvent, {
        sessionId: session.id,
        contextMeta,
      });

      // Auto-label: use first visible user message as label (skip SYSTEM_INIT prompts)
      let label: string | undefined = session.label ?? undefined;
      if (!label && !auto_greet) {
        label = effectiveMessage.length > 60 ? effectiveMessage.slice(0, 57) + '...' : effectiveMessage;
      }

      // Trim large tool results before writing back to DB. The LLM has already
      // consumed them; future turns only need the gist. This keeps the stored
      // history lean so compaction is triggered less often.
      const persistHistory = trimForPersistence(updatedHistory);

      // Estimate token count (1 token ≈ 4 chars) for observability.
      const tokenCount = Math.round(estimateHistoryChars(persistHistory) / 4);

      // Persist updated session
      await agentRepo.updateSession(db, actor.tenant_id, session.id, {
        messages: persistHistory,
        label,
        token_count: tokenCount,
      });

      sendEvent({ type: 'done', session_id: session.id, label: label ?? null });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Agent error';
      sendEvent({ type: 'error', message: errMsg });
    } finally {
      // setImmediate ensures the last SSE frames are flushed to the TCP buffer
      // before we close the connection, avoiding a race where res.end() races
      // ahead of the final write on some Node.js / proxy configurations.
      setImmediate(() => res.end());
    }
  });

  // ─── Activity log (admin: tenant-wide, user: own sessions only) ──────────────

  // GET /agent/activity — tenant-wide tool call log (admin) or own-session log (user)
  router.get('/activity', async (req: Request, res: Response) => {
    const actor = getActor(req);
    const isAdmin = actor.role === 'admin';

    const filters: activityRepo.ListActivityFilters = {
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : 50,
      cursor: req.query.cursor as string | undefined,
      toolName: req.query.tool_name as string | undefined,
      isError: req.query.is_error === 'true' ? true : req.query.is_error === 'false' ? false : undefined,
      since: req.query.since as string | undefined,
    };

    // Non-admins can only see their own tool calls
    if (!isAdmin) {
      filters.userId = actor.actor_id;
    } else if (req.query.user_id) {
      filters.userId = req.query.user_id as string;
    }

    const result = await activityRepo.listActivity(db, actor.tenant_id, filters);
    res.json(result);
  });

  // GET /agent/sessions/:id/activity — all tool calls in a specific session
  router.get('/sessions/:id/activity', async (req: Request, res: Response) => {
    const actor = getActor(req);
    const session = await agentRepo.getSession(db, actor.tenant_id, String(req.params.id));
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    // Non-admins can only view their own sessions
    if (actor.role !== 'admin' && session.user_id !== actor.actor_id) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    const activity = await activityRepo.getSessionActivity(db, actor.tenant_id, session.id);
    res.json({ activity });
  });

  return router;
}

