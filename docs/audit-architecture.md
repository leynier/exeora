# Audit storage contract

Every attempted tool execution first creates a durable, argument-free intent in the D1 `audit_outbox`. If that write fails, the gateway fails closed and does not touch the executor. After execution, the same row receives the outcome and is sent as one versioned event to a Cloudflare Pipelines stream whose sink is an Apache Iceberg table in R2 Data Catalog.

The outbox is a delivery mechanism, not a second query store. A Pipeline failure leaves the stable event id queued for retry, the five-minute cron recovers interrupted sends, and acknowledged rows are removed after seven days. Delivery is at-least-once because a Worker can stop after the stream accepts an event but before D1 records that acknowledgement; every warehouse query therefore deduplicates by id.

This deliberately spends bounded D1 writes to avoid silent audit loss. The long-lived, indexed per-call history remains in Iceberg, while D1 keeps only the short producer queue and roughly one `usage_daily` row per active account per day.

## What this gives and what it costs

- Individual calls remain queryable: Activity reads the archive through R2 SQL, filtered by account and paged by keyset on `(created_at, id)` because that engine has no `OFFSET`.
- A call becomes visible after its outbox delivery and when the sink rolls its file, normally within five minutes. An archive outage extends that delay without discarding the row.
- Arguments and output are never stored, here or anywhere.
- Exact account totals land on the next nightly rollup. Each UTC day is upserted monotonically into `usage_daily` (`max` of counters), paged from R2 SQL past its row limit, with the last three days replayed to pick up late events. Activity groups by the stable event id and the rollup uses `COUNT(DISTINCT id)`.
- Each Activity query is billed on compressed bytes scanned with a 10 MB floor, so every query carries the tightest time bound it can honestly claim.

## Deletion is asynchronous, and that is structural

R2 SQL is read-only. A row leaves the Iceberg table only when a transaction commits through the catalog, which a Worker cannot do. So the gateway records an intent and a job carries it out.

- Deleting an account, a machine or a project atomically writes the erasure intent and performs the destructive D1 mutation in one batch. A machine enqueues its projects, because the archive has no device column.
- `audit_deletions` deliberately has no foreign key to `users`: the cascade that deletes an account would take the instruction to erase it along with the account.
- The maintenance job leases work so concurrent runs cannot claim the same target. A successful catalog transaction schedules a second pass 24 hours later; only a second successful transaction closes the target, which catches events that were already in flight when erasure began. Failures do not count as passes, retain their error, and make the workflow fail visibly.
- Retention runs only when the durable rollup checkpoint has consumed every complete UTC day through yesterday. If R2 SQL or rollup catch-up is behind, the job pauses pruning and exits unsuccessfully instead of deleting uncounted rows.
- Deleting a *client* no longer deletes the calls it made. The queue erases by account or by project, and a client is neither; what goes is the record of who the client was, not the record of what happened.

Orphan files and old snapshots are handled by managed snapshot expiration, which has removed unreferenced data files since 2026-04-22. That is a setting, not a job to write.

## Why Iceberg, not plain Parquet

Plain Parquet is the lowest-maintenance archive, but it cannot support exact reprocessing, selective deletion or R2 SQL. Iceberg costs more to query and needs compaction, but it is the only Pipelines sink that can both answer Activity and be erased from.

Provisioning, tokens and the maintenance job live in [`apps/gateway/pipelines/readme.md`](../apps/gateway/pipelines/readme.md).
