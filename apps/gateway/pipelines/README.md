# Audit Pipelines prototype

The scalable audit path is a structured Pipelines stream with an R2 Data Catalog (Iceberg) sink. Iceberg is intentional: plain Parquet is cheaper to maintain, but cannot provide the exact daily usage rollup or selective retention checks required before cutting D1 over.

## Provision

From `apps/gateway`:

```bash
bunx wrangler pipelines setup --name exeora-audit
```

Choose:

- schema from `pipelines/audit.schema.json`;
- simple `SELECT * FROM stream` transform;
- R2 Data Catalog sink;
- table `default.tool_calls`;
- authenticated HTTP ingestion disabled (the Worker binding is sufficient).

Merge the emitted stream id using `pipelines/wrangler.fragment.jsonc`, run `bun run types`, then set `AUDIT_WRITE_MODE` to `dual`. Do not set it directly to `pipeline`: dual mode is the validation period.

The nightly exact rollup also requires these Worker values/secrets:

```text
CLOUDFLARE_ACCOUNT_ID
AUDIT_R2_BUCKET
AUDIT_R2_WAREHOUSE
AUDIT_R2_TABLE=default.tool_calls
AUDIT_WAREHOUSE_START_DAY=YYYY-MM-DD
AUDIT_R2_SQL_TOKEN  (secret)
```

## Acceptance gates

Keep dual mode until all of these have been measured from production-shaped traffic:

1. Accepted stream events equal D1 inserts by stable event `id`; Pipelines user-error metrics show no schema drops.
2. A maximum-size batch stays below 5 MB/request and sustained ingress stays below 5 MB/s/stream.
3. Sink availability latency and the three-day late-event replay meet the next-day usage contract.
4. Daily `COUNT(*)` / error totals from R2 SQL match D1 totals for at least seven days (event ids are unique; avoid budget-gated `COUNT(DISTINCT)`).
5. Query metrics (`files_scanned`, `bytes_scanned`, R2 requests) fit the operating budget after compaction.
6. An Iceberg maintenance job demonstrably deletes expired user rows and orphan files. Snapshot expiration or an R2 lifecycle rule alone does not satisfy this gate.

After the gates pass, `AUDIT_WRITE_MODE=pipeline` stops D1 `tool_calls` writes. The Activity API then explicitly reports that interactive history is unavailable; `usage_daily` remains exact and idempotent.
