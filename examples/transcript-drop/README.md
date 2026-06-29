# Transcript Drop Fixture

This fixture gives admins a repeatable local-folder transcript-drop test without using real customer content.

Files:

- `northstar-renewal-review.txt`: synthetic meeting transcript.
- `northstar-renewal-review.json`: sidecar metadata with title, meeting time, attendees, account hint, source URL, and authorship.

Local-folder smoke path:

```bash
export CRMY_LOCAL_SOURCE_ROOTS="$(pwd)/examples/transcript-drop"
export CRMY_ENABLE_LOCAL_CONTEXT_DROPS=true

crmy activities transcript-source create-local \
  --name "Northstar transcript fixture" \
  --path "$(pwd)/examples/transcript-drop"

crmy activities transcript-source sync <source-id>
crmy activities transcripts --status needs_review
```

Expected behavior:

1. CRMy discovers the transcript and sidecar as one source object.
2. If demo data is loaded, Northstar Labs should be the strongest account match.
3. If the meeting cannot be matched confidently to a calendar event, the object stays reviewable instead of disappearing.
4. Resolving the source object should create or attach a meeting artifact, then feed Sources -> Signals -> Memory with lineage back to the source object.
5. Because this transcript contains both internal and customer speakers, downstream context should be treated as mixed-source evidence, not purely customer-authored fact.
6. If the configured model is uncertified, extracted claims should remain reviewable Signals until a human reviews them or `crmy certify --output ./eval-runs` passes for that exact model.

For S3-compatible testing, upload both files with the same basename to an S3-compatible test bucket prefix and create an S3 transcript source that points at that prefix.
