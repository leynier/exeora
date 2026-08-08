# Audit storage contract

Every tool call is sent as one versioned, argument-free event to a Cloudflare Pipelines stream whose sink is an Apache Iceberg table in R2 Data Catalog. D1 holds no per-call row.

The reason is economics rather than taste. D1 bills reads and writes, and an insert with two indexes counts as about three writes, so an audit trail in D1 costs more the more the product is used. The archive replaces that with roughly one `usage_daily` row per active account per day.

## What this gives and what it costs

- Individual calls remain queryable: Activity reads the archive through R2 SQL, filtered by account and paged by keyset on `(created_at, id)` because that engine has no `OFFSET`.
- A call becomes visible when the sink rolls its file, currently up to five minutes after it is made, rather than the instant it happens. The empty state says so.
- Arguments and output are never stored, here or anywhere.
- Exact account totals land on the next nightly rollup. Each UTC day is upserted monotonically into `usage_daily` (`max` of counters), paged from R2 SQL past its row limit, with the last three days replayed to pick up late events. Event ids are unique, so the producer uses `COUNT(*)`.
- Each Activity query is billed on compressed bytes scanned with a 10 MB floor, so every query carries the tightest time bound it can honestly claim.

## Deletion is asynchronous, and that is structural

R2 SQL is read-only. A row leaves the Iceberg table only when a transaction commits through the catalog, which a Worker cannot do. So the gateway records an intent and a job carries it out.

- Deleting an account, a machine or a project writes a row into `audit_deletions`, always **before** the D1 statement whose cascade would otherwise erase the evidence of what to delete. A machine enqueues its projects, because the archive has no device column.
- `audit_deletions` deliberately has no foreign key to `users`: the cascade that deletes an account would take the instruction to erase it along with the account.
- The maintenance job drains the queue nightly and applies retention. It closes a target only after its transaction commits, so a run that dies halfway leaves the rest queued rather than silently dropped.
- Deleting a *client* no longer deletes the calls it made. The queue erases by account or by project, and a client is neither; what goes is the record of who the client was, not the record of what happened.

Orphan files and old snapshots are handled by managed snapshot expiration, which has removed unreferenced data files since 2026-04-22. That is a setting, not a job to write.

## Why Iceberg, not plain Parquet

Plain Parquet is the lowest-maintenance archive, but it cannot support exact reprocessing, selective deletion or R2 SQL. Iceberg costs more to query and needs compaction, but it is the only Pipelines sink that can both answer Activity and be erased from.

Provisioning, tokens and the maintenance job live in [`apps/gateway/pipelines/README.md`](../apps/gateway/pipelines/README.md).
