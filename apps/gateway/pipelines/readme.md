# Audit archive

The durable audit trail is a structured Pipelines stream with an R2 Data Catalog (Iceberg) sink. D1 also holds a bounded producer outbox: the gateway persists an intent before executing a tool, retries stream failures every five minutes, and removes acknowledged rows after seven days. Activity, usage rollups and retention read Iceberg rather than that transient queue.

This archive is required. If the D1 intent cannot be written, the tool is not executed. If the Pipeline is temporarily unavailable, the stable event remains queued and execution can complete without silently losing its audit record.

Iceberg rather than plain Parquet, because plain Parquet cannot answer Activity and cannot be erased from. The reasoning is in [`audit-architecture.md`](../../../docs/audit-architecture.md).

## Provision

From `apps/gateway`:

```bash
bunx wrangler pipelines setup --name exeora_audit
```

Underscores, not hyphens: `pipelines setup` rejects any other punctuation. The name is only a label, and nothing in the gateway reads it. The rollup checkpoint is keyed by account, bucket, warehouse and table (`sourceKey` in `src/warehouse-usage.ts`), so renaming the stream later does not orphan it.

Answer the wizard:

| Prompt | Answer | Why |
| --- | --- | --- |
| Enable HTTP endpoint for sending data? | **no** | The gateway writes through the Worker binding. An HTTP endpoint is a second door into the audit table, and left unauthenticated it lets anyone forge tool-call events against any account, which then inflate `usage_daily` and the plan limits read from it. |
| Schema | **Load from file** → `apps/gateway/pipelines/audit.schema.json` | Must match `AuditEvent` exactly; it is what R2 SQL later queries. |
| Transform | `SELECT * FROM stream` | The gateway already emits the table's shape. A transform would be a second place the schema is defined. |
| Destination type | **Data Catalog (Iceberg)** | A plain R2 bucket gives Parquet with no selective row deletion and no R2 SQL, which loses both account erasure and the exact rollup. |
| R2 bucket name | `exeora-audit` | Hyphens here, unlike the pipeline name: R2 buckets reject underscores. |
| Namespace / table | `default` / `tool_calls` | Underscores here, unlike the bucket: `AUDIT_R2_TABLE` is validated as `namespace.table` against `[a-zA-Z_][\w]*`. |

Three names, three different punctuation rules. `exeora_audit` for the pipeline, `exeora-audit` for the bucket, `tool_calls` for the table.

Merge the emitted stream id using `pipelines/wrangler.fragment.jsonc` and run `bun run types`.

Then turn on the two maintenance operations. Both are managed features rather than jobs to write:

```bash
wrangler r2 bucket catalog compaction enable <bucket> --target-size 256
wrangler r2 bucket catalog snapshot-expiration enable <bucket> --older-than-days 30 --retain-last 5
```

Snapshot expiration is what reclaims the files a delete leaves behind: since 2026-04-22 it removes unreferenced data files as well as old snapshots, so no `remove_orphan_files` job is needed. It is free.

## Tokens

Three, one per holder. The split is deliberate rather than tidy: the token that can delete from the audit table must never be in the process that serves requests, and one holder losing a token must not take the others down with it.

Create each from the dashboard: **R2 Object Storage → Manage API tokens → Create API token**. Name them, because three unnamed `R2 Token` entries are indistinguishable a month later. Copy the **Token value**, not the Access Key ID / Secret Access Key: those are for the S3-compatible API, and the catalog, the sink and R2 SQL all want the token value.

Choose **Account** tokens, not User tokens. All three are machine credentials held by a sink, a Worker and a CI job; a user token inherits one person's permissions and stops working when that person's role changes, which would take audit ingestion down with it. Creating account tokens requires the Super Administrator role.

| Token | Permission | Held by |
| --- | --- | --- |
| Catalog token | **Admin Read & Write** | The Pipelines sink, entered during `pipelines setup` |
| `AUDIT_R2_SQL_TOKEN` | **Admin Read only** | The Worker, for the nightly rollup and Activity |
| Maintenance token | **Admin Read & Write** | The deletion job only, never the Worker |

The sink's token and the maintenance token carry the same permissions and could be one token. They are not, so that revoking the job's credentials never stops audit ingestion.

These cannot be scoped to `exeora-audit`. R2 Data Catalog requires an Admin-level token, and only the object-scoped levels take a bucket list, so all three reach every R2 bucket in the account. Worth knowing before deciding what else lives in that account.

## Worker configuration

```text
CLOUDFLARE_ACCOUNT_ID
AUDIT_R2_BUCKET=exeora-audit
AUDIT_R2_WAREHOUSE=<account_id>_exeora-audit
AUDIT_R2_TABLE=default.tool_calls
AUDIT_WAREHOUSE_START_DAY=YYYY-MM-DD
AUDIT_R2_SQL_TOKEN         (secret, the Admin Read only token)
AUDIT_MAINTENANCE_SECRET   (secret, shared with the deletion job)
```

Set `AUDIT_WAREHOUSE_START_DAY` to the day the stream starts receiving events. It is the first UTC day the table can contain, and dating it earlier only makes the rollup query empty days every night.

`AUDIT_MAINTENANCE_SECRET` is any 32-byte random string (`openssl rand -base64 32`), set both here and as a repository secret. It is what the deletion job authenticates with, and while it is unset the `/internal/*` routes answer 404 rather than advertising themselves.

Set the Worker-held secrets explicitly:

```bash
bun run secret AUDIT_R2_SQL_TOKEN
bun run secret AUDIT_MAINTENANCE_SECRET
```

## Deleting from the archive

R2 SQL is read-only, so the gateway cannot delete its own audit rows: a row only goes when a transaction commits through the catalog. Deletion is therefore recorded and drained rather than done.

- `deleteAccount`, permanent machine deletion and project deletion enqueue into `audit_deletions` in the same D1 batch as the destructive mutation. A machine enqueues its projects, because the archive has no device column.
- The job atomically leases up to 100 targets with `POST /internal/audit-deletions/claim`, commits each catalog delete, and reports the result to `POST /internal/audit-deletions/:id` with the lease token. A failed transaction stays queued and does not count as an erasure pass.
- The first successful pass is requeued for 24 hours later. Only the second successful catalog transaction closes it, so a delayed event that was already inside Pipelines when deletion began is removed too.
- Retention comes from `GET /internal/retention`, which returns the two windows, the ids of accounts on the longer one, and the durable rollup checkpoint. The job refuses to prune and exits nonzero unless that checkpoint has reached yesterday.

The job is `scripts/audit-maintenance/main.py`, run nightly by `.github/workflows/audit-maintenance.yml`. Its Python 3.12 and PyIceberg dependency are pinned in PEP 723 metadata and `main.py.lock`; the workflow tests the maintenance logic before running the locked script. PyIceberg rather than PySpark keeps the runner free of a JVM.

It lives outside Cloudflare, which is the cost of that choice: a self-hosted gateway needs this workflow in a fork with its own secrets, or nothing drains its queue. Repository secrets: `AUDIT_CATALOG_URI`, `AUDIT_R2_WAREHOUSE`, `AUDIT_R2_MAINTENANCE_TOKEN`, `GATEWAY_URL`, `AUDIT_MAINTENANCE_SECRET`.

It runs at 05:30 UTC, after the gateway's own cron. The checkpoint gate enforces the dependency even when the earlier cron fails or needs several nights to catch up, so schedule order alone is not the safety mechanism.

Two things it learned the hard way, both recorded in its comments: Cloudflare's WAF answers 403 to the default `Python-urllib` user agent before the request reaches the Worker, and `created_at` is a zone-free Iceberg `timestamp`, so a literal carrying an offset will not bind.

## After a change

Compaction and snapshot expiration hold service credentials of their own, so rotating the catalog token silently stops them. Re-run both `enable` commands with the new token.

Worth measuring as volume grows, because it decides what Activity costs: `EXPLAIN` on an Activity-shaped query reports `files_scanned` and `bytes_scanned`. How well one account's query prunes depends on how the sink lays rows out across files, which the schema does not fix.
