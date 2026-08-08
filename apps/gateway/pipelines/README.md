# Audit Pipelines prototype

The scalable audit path is a structured Pipelines stream with an R2 Data Catalog (Iceberg) sink. Iceberg is intentional: plain Parquet is cheaper to maintain, but cannot provide the exact daily usage rollup or selective retention checks required before cutting D1 over.

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
| Transform | `SELECT * FROM stream` | |
| Destination type | **Data Catalog (Iceberg)** | A plain R2 bucket gives Parquet with no selective row deletion and no R2 SQL, which loses both account erasure and the exact rollup. |
| R2 bucket name | `exeora-audit` | Hyphens here, unlike the pipeline name: R2 buckets reject underscores. |
| Namespace / table | `default` / `tool_calls` | Underscores here, unlike the bucket: `AUDIT_R2_TABLE` is validated as `namespace.table` against `[a-zA-Z_][\w]*`. |

Three names, three different punctuation rules. `exeora_audit` for the pipeline, `exeora-audit` for the bucket, `tool_calls` for the table.

Merge the emitted stream id using `pipelines/wrangler.fragment.jsonc`, run `bun run types`, then set `AUDIT_WRITE_MODE` to `dual`. Do not set it directly to `pipeline`: dual mode is the validation period.

Then turn on the two maintenance operations. Both are managed features rather than jobs to write, and gate 5 assumes compaction is running:

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

The nightly exact rollup also requires these Worker values/secrets:

```text
CLOUDFLARE_ACCOUNT_ID
AUDIT_R2_BUCKET=exeora-audit
AUDIT_R2_WAREHOUSE=<account_id>_exeora-audit
AUDIT_R2_TABLE=default.tool_calls
AUDIT_WAREHOUSE_START_DAY=YYYY-MM-DD
AUDIT_R2_SQL_TOKEN         (secret, the Admin Read only token)
AUDIT_MAINTENANCE_SECRET   (secret, shared with the deletion job)
```

Set `AUDIT_WAREHOUSE_START_DAY` to the day `dual` mode is switched on. It is the first UTC day the table can contain, and dating it earlier only makes the rollup query empty days every night.

`AUDIT_MAINTENANCE_SECRET` is any 32-byte random string (`openssl rand -base64 32`), set both here and as a repository secret for the deletion job.

`AUDIT_MAINTENANCE_SECRET` is what the deletion job authenticates with. While it is unset the `/internal/*` routes answer 404, so a `d1`-mode deployment does not expose them at all.

## Deleting from the archive

R2 SQL is read-only, so the gateway cannot delete its own audit rows: a row only goes when a transaction commits through the catalog. Deletion is therefore recorded and drained rather than done.

- `deleteAccount`, permanent machine deletion and project deletion write a row into `audit_deletions` in D1, **before** the statement whose cascade would otherwise erase the evidence of what to delete. A machine enqueues its projects, because the archive has no device column.
- The job reads `GET /internal/audit-deletions`, commits its deletes, and closes each target with `POST /internal/audit-deletions/:id`.
- Retention comes from `GET /internal/retention`, which returns the two windows and the ids of accounts on the longer one. Deleting past the longest window needs no list; sparing the longer-plan accounts does, and that set is the small one.

The job is `scripts/audit-maintenance/main.py`, run nightly by `.github/workflows/audit-maintenance.yml`. PyIceberg rather than PySpark: Cloudflare documents Spark for `DELETE`, but `table.delete(delete_filter=...)` was verified against this catalog and keeps the runner free of a JVM.

It lives outside Cloudflare, which is the cost of that choice: a self-hosted gateway needs this workflow in a fork with its own secrets, or nothing drains its queue. Repository secrets: `AUDIT_CATALOG_URI`, `AUDIT_R2_WAREHOUSE`, `AUDIT_R2_MAINTENANCE_TOKEN`, `GATEWAY_URL`, `AUDIT_MAINTENANCE_SECRET`.

It runs at 05:30 UTC, after the gateway's own cron. The order matters: pruning a day before the rollup has read it would undercount that day's usage, and `usage_daily` is what plan limits read.

## Acceptance gates

Keep dual mode until all of these have been measured from production-shaped traffic:

1. Accepted stream events equal D1 inserts by stable event `id`; Pipelines user-error metrics show no schema drops.
2. A maximum-size batch stays below 5 MB/request and sustained ingress stays below 5 MB/s/stream.
3. Sink availability latency and the three-day late-event replay meet the next-day usage contract.
4. Daily `COUNT(*)` / error totals from R2 SQL match D1 totals for at least seven days (event ids are unique; avoid budget-gated `COUNT(DISTINCT)`).
5. Query metrics (`files_scanned`, `bytes_scanned`, R2 requests) fit the operating budget after compaction.
6. Expired and erased rows demonstrably leave the table. Orphan files are covered by managed snapshot expiration since 2026-04-22; what still has to be shown is that the deletion job drains `audit_deletions` and that a deleted account's rows stop appearing in R2 SQL results.

After the gates pass, `AUDIT_WRITE_MODE=pipeline` stops D1 `tool_calls` writes. The Activity API then explicitly reports that interactive history is unavailable; `usage_daily` remains exact and idempotent.
