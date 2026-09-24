# Audit storage contract

Every attempted execution first persists an argument-free intent. The normal path awaits confirmed ingestion by the structured Cloudflare Pipelines stream **before** it contacts the executor. A second event records the outcome with the same stable `id` and `created_at`. Both use the existing v1/v2 schema and the R2 Data Catalog (Iceberg) sink.

If the stream cannot acknowledge the intent, `beginAudit` falls back to D1 `audit_outbox`. If neither durable destination accepts it, the gateway fails closed: no tool runs. If the outcome send fails, the completed event enters the retry outbox. A Worker interruption leaves an explicit incomplete intent, rather than silently making the execution disappear. A missing final outcome is not proof that the tool failed, and must never cause an automatic command retry.

## Healthy path and recovery

- Healthy execution makes **zero D1 audit queries** and two small stream writes. This does not mean the whole MCP request avoids D1: authorization and throttled presence/client metadata remain relational.
- Stream acknowledgement means ingestion, not that the sink has already made the row queryable. The configured schema must match the producer: Pipelines can acknowledge invalid records and later drop them. Keep the stream schema and `AUDIT_SCHEMA_VERSION` aligned and monitor sink/user-error metrics.
- Delivery is at-least-once. Lost acknowledgements may create duplicates; all copies preserve the event id and execution-start timestamp.
- The existing five-minute sweeper still leases retry batches, recovers interrupted D1-backed intents, and backs off failed sends. Acknowledged outbox rows now expire after **24 hours**, rather than seven days. Undelivered rows are retained for recovery, not silently discarded at that deadline.
- No arguments or tool output are stored. The optional workspace fields keep their frozen `worktree_*` warehouse names.

Cloudflare documents the acknowledgement contract at <https://developers.cloudflare.com/pipelines/streams/writing-to-streams/>. Ingestion volume is roughly twice the old one-event model; the saving is avoiding multiple indexed D1 writes per healthy call, not free storage or zero-cost requests.

## Reading and accounting

Activity resolves each intent/outcome pair **before** status filters and keyset pagination. A final outcome outranks `AUDIT_INCOMPLETE`, regardless of ingestion order. Identical retries collapse to one row. A recent unresolved intent is hidden for fifteen minutes; an older unresolved intent appears explicitly as incomplete. Legacy single-event records use the same reader.

`COUNT(DISTINCT id)` counts an attempted execution once. The daily error counter includes **confirmed error outcomes only**, not incomplete intents. Otherwise an intent followed by a delayed success would permanently inflate the monotonic error counter. Unknown outcomes remain inspectable in Activity; they are not reclassified as confirmed failures for billing or metrics.

Exact daily counts are stored in D1 `usage_daily`. The nightly warehouse rollup, cursor/checkpoint, three-day replay and deletion safeguards remain in place. There is no sampled Analytics Engine substitute for these exact counters.

## Retention: visibility is not physical erasure

Free Activity is a **rolling 24-hour window**; Pro keeps its 365-day window. The server derives the window from the account being queried, including on the admin endpoint. A cursor cannot widen it. Every archive query includes the lower/upper timestamp bounds; an expired cursor returns without a billed R2 SQL scan.

The maintenance job applies a rolling UTC cutoff through Iceberg transactions, not by rounding down to the previous midnight. It retains the existing rollup gate and never deletes an uncounted day. The existing nightly schedule is unchanged; missed maintenance, ingestion delays and a paused rollup can delay physical cleanup. Iceberg snapshots, Pipelines buffering and recovery outbox rows are separate retention layers.

**This is not a promise that every physical copy disappears at precisely 24 hours.** The API enforces the visibility boundary immediately. Physical erasure is asynchronous and requires healthy maintenance plus appropriate snapshot-expiration settings. Do not use an R2 object lifecycle to delete live Iceberg files: that corrupts the catalog. A contractual maximum physical lifetime requires a separately verified end-to-end retention design, not just `retentionDays = 1`.

## Deletion remains asynchronous

R2 SQL is read-only. A row leaves the table only when a transaction commits through the catalog.

- Deleting an account, machine or project atomically enqueues its erasure intent with the destructive D1 mutation. `audit_deletions` has no user foreign key, so account deletion cannot remove the instruction to erase its archive.
- The job leases targets and requires two successful catalog transactions at least 24 hours apart to catch events already in flight. Failed passes remain queued and make the job fail visibly.
- Retention pauses if the durable rollup checkpoint has not consumed every complete UTC day through yesterday.
- Deleting a client removes its access record, not the history of executions attributed to it.
- Managed snapshot expiration reclaims unreferenced files. Its policy is independent of Activity's visibility window.

## Rollout and rollback

Deploy the writer, Activity reader and usage query changes together. The stream/table schemas are unchanged, so no new bucket, stream, credential or database migration is required. Existing outbox rows remain deliverable. Do not roll back only the reader after paired events have been ingested: an old reader would expose the intent as a second error row. A rollback must retain the resolving reader and incomplete-aware usage query.

The relay already uses hibernatable caller/executor WebSockets and automatic heartbeat responses. Its deadline, approval, cancellation and offline guarantees are unchanged by this work. Client timestamps and device checkpoints are already throttled; this change does not replace their authorization checks with a stale cache.

Provisioning, tokens and the maintenance job are documented in [`apps/gateway/pipelines/readme.md`](../apps/gateway/pipelines/readme.md).
