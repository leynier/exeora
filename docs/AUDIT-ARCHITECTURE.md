# Audit storage contract

Exeora supports two audit contracts because the interactive D1 design and the high-volume design have materially different economics.

## Current contract (`AUDIT_WRITE_MODE=d1`)

- Individual tool-call metadata is queryable and filterable in Activity.
- Arguments and output are never stored.
- D1 retention follows the account plan (90 days Free, 365 days Pro).
- Account, project and machine deletion remove the associated D1 rows in the same operation.
- `usage_daily` is rebuilt nightly before expired audit rows are pruned.

This remains the default and is the only production-ready mode.

## Scalable contract (`AUDIT_WRITE_MODE=pipeline`)

- One versioned, argument-free event is sent to a structured Pipelines stream and an R2 Data Catalog (Iceberg) table.
- Individual events are an operational archive, not an interactive product surface. Activity says this explicitly instead of returning a misleading empty history.
- Exact account totals become available on the next nightly rollup. Each UTC day is upserted monotonically into D1 (`max` of counters), paged from R2 SQL past its row limit, and the last three days are replayed to incorporate late events. Event ids are unique, so the producer uses `COUNT(*)`.
- The request path no longer writes `tool_calls`; D1 receives approximately one `usage_daily` row per active account and day.
- User-level deletion is asynchronous. Pipeline mode must not be enabled for production until an Iceberg row-deletion and orphan-file maintenance job has been deployed and verified. R2 lifecycle deletion and snapshot expiration alone do not delete rows from append-only data files.

`dual` mode writes both sources only for reconciliation. Pipeline send failure never fails a tool call, so operators must alert on stream user-error/drop metrics and compare event ids/totals before cutover.

## Why Iceberg, not plain Parquet

Plain Parquet is the lowest-maintenance archive, but it cannot support exact reprocessing, selective deletion or R2 SQL. Iceberg costs more to query and requires compaction/expiration maintenance, but it is the only Pipelines sink that can replace the exact `usage_daily` producer without putting a write back on every tool call.

The full provisioning and validation checklist lives in `apps/gateway/pipelines/README.md`.
