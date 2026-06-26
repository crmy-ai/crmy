# Provider Certification Checklist for 0.9.3

Use this checklist before claiming live Google or Microsoft mailbox/calendar support for a public production tenant. The local demo and automated tests verify CRMy behavior around OAuth readiness, scopes, sender resolution, sync queues, matching, lineage, and failure states. This checklist verifies provider behavior that can only be proven against real or sandbox provider accounts.

## Scope

Certification covers:

- Gmail mailbox context sync.
- Gmail mailbox send and provider draft creation.
- Google Calendar sync and free/busy availability.
- Outlook mailbox context sync.
- Outlook mailbox send and provider draft creation.
- Microsoft 365 calendar sync and free/busy availability.

Run this once per provider app source:

- CRMy-managed hosted OAuth app.
- Tenant-owned enterprise OAuth app.
- Self-hosted environment-managed OAuth app.

## Prerequisites

1. Start from a migrated 0.9.3 database.
2. Configure `CRMY_PUBLIC_URL` to the externally reachable CRMy base URL.
3. Open **Settings -> System Connections -> OAuth** as an admin.
4. Select the provider under test and verify Mailbox and Calendar readiness.
5. Confirm the redirect URI shown in CRMy exactly matches the provider console.
6. Confirm test accounts include at least one internal actor mailbox/calendar and one external customer contact domain.
7. Use a test customer account with primary or additional domain matching the external contact.

Do not use real customer content in certification. Use synthetic accounts, contacts, emails, meetings, and transcript fixtures.

## Gmail Mailbox

1. Connect Gmail from **Customer Email -> Mailboxes & Senders** with all three toggles enabled:
   - Use email for customer context.
   - Send approved drafts from this mailbox.
   - Create provider drafts when available.
2. Confirm the connection card shows connected mailbox, sender ready, and provider drafts available.
3. Send a synthetic external email to the Gmail test mailbox from a contact on the test account domain.
4. Queue mailbox sync.
5. Verify the message appears in **Customer Email -> Mailbox Context**.
6. Process the message into Raw Context.
7. Verify Raw Context, Signals, Memory candidates, and Lineage point back to the email message and mailbox connection.
8. Draft a reply from CRMy.
9. Verify the draft response includes sender metadata for the Gmail actor mailbox.
10. Create a provider draft and confirm it appears in Gmail Drafts.
11. Send through CRMy after approval.
12. Verify the sent email is recorded as account activity and CRMy-authored context, not customer-authored evidence.
13. Reply from the external contact and sync again.
14. Verify reply matching uses provider thread id or message headers and links inbound message -> outbound draft/send -> customer reply.

## Google Calendar

1. Connect Google Calendar from **Customer Activity -> Meeting Sources**.
2. Confirm the callback stores the provider-verified email, not user-entered identity alone.
3. Create a synthetic meeting with an external attendee from the test account domain.
4. Queue calendar sync.
5. Verify the event appears in **Customer Activity -> Meetings** and links to the account through domain matching.
6. Attach or drop a transcript fixture for the meeting.
7. Verify it becomes a meeting artifact, Raw Context source, Signals, and reviewable Memory candidates.
8. Call `availability_suggest_times` for the test account and internal actor.
9. Verify the response uses internal free/busy windows, does not expose raw event details, and includes caveats.

## Outlook Mailbox

Repeat the Gmail mailbox steps using Outlook. Additional checks:

- Confirm Microsoft Graph consent includes `offline_access`, `User.Read`, `Mail.Read`, `Mail.Send`, and `Mail.ReadWrite` when send and provider drafts are enabled.
- Confirm conversation id is preserved on outbound metadata when present.
- Confirm a provider draft can be found in Outlook Drafts or a friendly unsupported/error state is shown.

## Microsoft 365 Calendar

Repeat the Google Calendar steps using Microsoft 365. Additional checks:

- Confirm Microsoft Graph calendar identity matches the authenticated account.
- Confirm free/busy failures are user-friendly and visible in Reliability.
- Confirm sync retries do not duplicate calendar events or meeting artifacts.

## Failure Cases

For each provider, verify:

- Redirect URI mismatch returns a friendly setup error and points admins to System Connections.
- Missing send scope connects context-only and marks sender unavailable.
- Revoked OAuth token shows a reauthorization path and does not silently skip sync forever.
- Provider 403/429/5xx errors are captured as retryable or actionable operational issues without logging message body, transcript text, tokens, or secrets.
- Disconnect removes stored OAuth tokens. Deactivate pauses sync and sender use without deleting tokens.

## Pass Criteria

A provider/app-source combination is certified when:

- Connect, sync, draft, send, reply, calendar sync, transcript processing, availability, disconnect, and reconnect all pass.
- Every provider failure produces an actionable user/admin message.
- Raw Context lineage remains traceable from provider object to Signals and Memory.
- CRMy-authored outbound email is distinguishable from customer-authored evidence.
- No provider token, webhook secret, OAuth client secret, message body, or transcript text appears in application logs during the run.

Record each run with provider, app source, CRMy version, date, tester, account domain, and pass/fail notes.
