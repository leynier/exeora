# /// script
# requires-python = "==3.12.*"
# dependencies = ["pyiceberg[pyarrow]==0.11.1"]
# ///

"""Removes from the audit archive what the gateway cannot remove itself.

R2 SQL is read-only, so a row leaves the Iceberg table only when a transaction
commits through the catalog. The gateway therefore records an intent and this
job carries it out, which is the asynchronous deletion `docs/audit-architecture.md`
describes.

Two jobs in one run, in this order:

1. Erasure. Accounts and projects the gateway was asked to forget. Ordered
   first because somebody is waiting on it and because it is bounded.
2. Retention. Rows older than the window their owner's plan allows.

Nothing here is idempotent by accident. A target is closed only after two
successful transactions at least 24 hours apart, so a run that dies halfway
leaves the rest queued and events already in flight are caught by the recheck.
"""

from __future__ import annotations

import datetime as dt
import json
import os
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Protocol

TIMEOUT_S = 60


class Table(Protocol):
    def delete(self, *, delete_filter: str) -> None: ...


class Catalog(Protocol):
    def load_table(self, table: str) -> Table: ...


@dataclass(frozen=True)
class Settings:
    catalog_uri: str
    warehouse: str
    token: str
    table: str
    gateway: str
    secret: str
    legacy_table: str | None = None

    @staticmethod
    def from_env() -> "Settings":
        def need(name: str) -> str:
            value = os.environ.get(name, "").strip()
            if not value:
                sys.exit(f"{name} is required")
            return value

        return Settings(
            catalog_uri=need("CATALOG_URI"),
            warehouse=need("WAREHOUSE"),
            token=need("AUDIT_R2_MAINTENANCE_TOKEN"),
            table=os.environ.get("AUDIT_R2_TABLE", "default.tool_calls_v2"),
            legacy_table=os.environ.get("AUDIT_R2_LEGACY_TABLE", "").strip() or None,
            gateway=need("GATEWAY_URL").rstrip("/"),
            secret=need("AUDIT_MAINTENANCE_SECRET"),
        )


def gateway_request(
    settings: Settings,
    path: str,
    body: dict | None = None,
    *,
    method: str | None = None,
) -> dict:
    request = urllib.request.Request(
        f"{settings.gateway}{path}",
        method=method or ("POST" if body is not None else "GET"),
        headers={
            "authorization": f"Bearer {settings.secret}",
            "content-type": "application/json",
            # Named, and not left to urllib. Cloudflare's WAF answers 403 to the
            # default `Python-urllib/x.y` before the request reaches the Worker,
            # which reads as an auth failure and is not one.
            "user-agent": "exeora-audit-maintenance",
        },
        data=None if body is None else json.dumps(body).encode(),
    )
    with urllib.request.urlopen(request, timeout=TIMEOUT_S) as response:
        return json.loads(response.read() or b"{}")


@dataclass(frozen=True)
class EraseResult:
    passes: int
    failed: int


def erase(catalog: Catalog, settings: Settings) -> EraseResult:
    """Drains the gateway's deletion queue, one committed transaction at a time."""
    pending = gateway_request(
        settings,
        "/internal/audit-deletions/claim",
        method="POST",
    ).get("items", [])
    if not pending:
        print("nothing to erase")
        return EraseResult(passes=0, failed=0)

    done = 0
    failed = 0
    for item in pending:
        column = "user_id" if item["scope"] == "user" else "project_id"
        target = item["targetId"]
        try:
            for table_name in tables(settings):
                table = catalog.load_table(table_name)
                table.delete(delete_filter=f"{column} == {sql_literal(target)}")
        except Exception as error:  # noqa: BLE001
            # Reported rather than raised: one unerasable target must not stop
            # the queue, and the gateway keeps it pending with the reason.
            print(f"failed {item['scope']} {target}: {type(error).__name__}: {error}")
            settle(
                settings,
                item["id"],
                item["leaseToken"],
                ok=False,
                error=f"{type(error).__name__}: {error}",
            )
            failed += 1
            continue

        # Only now. This reports one committed pass; the gateway deliberately
        # requeues the first success and closes the target after the second.
        settle(settings, item["id"], item["leaseToken"], ok=True)
        done += 1
        print(f"committed erasure pass for {item['scope']} {target}")

    return EraseResult(passes=done, failed=failed)


def prune(catalog: Catalog, settings: Settings, today: dt.date) -> bool:
    """Applies each plan's retention window.

    Two statements, and the shape is inverted on purpose. Everything past the
    longest window goes with no list at all. Sparing the longer-plan accounts
    needs their ids, and those are the small set: paying accounts are a
    fraction of all accounts, so naming them is what scales.
    """
    policy = gateway_request(settings, "/internal/retention")
    rollup = policy.get("rollup", {})
    if not rollup.get("pruneAllowed", False):
        detail = rollup.get("error") or (
            f"checkpoint {rollup.get('lastCompleteDay')} has "
            f"{rollup.get('backlogDays')} day(s) pending before {rollup.get('targetDay')}"
        )
        print(f"retention paused: {detail}", file=sys.stderr)
        return False

    longest = cutoff(today, policy["longestDays"])
    for table_name in tables(settings):
        table = catalog.load_table(table_name)
        table.delete(delete_filter=f"created_at < {sql_literal(longest)}")
    print(f"pruned everything before {longest}")

    exempt = policy["exemptUserIds"]
    shortest = cutoff(today, policy["shortestDays"])
    if policy["shortestDays"] == policy["longestDays"]:
        return True

    spare = (
        ""
        if not exempt
        else " and " + " and ".join(f"user_id != {sql_literal(user)}" for user in exempt)
    )
    for table_name in tables(settings):
        table = catalog.load_table(table_name)
        table.delete(delete_filter=f"created_at < {sql_literal(shortest)}{spare}")
    print(f"pruned before {shortest}, sparing {len(exempt)} longer-plan accounts")
    return True


def settle(
    settings: Settings,
    deletion_id: str,
    lease_token: str,
    *,
    ok: bool,
    error: str = "",
) -> None:
    body = {"ok": ok, "leaseToken": lease_token}
    if not ok:
        body["error"] = error[:500]
    try:
        gateway_request(settings, f"/internal/audit-deletions/{deletion_id}", body)
    except urllib.error.HTTPError as http_error:
        # 404 means another run already closed it, which is not a problem.
        if http_error.code != 404:
            raise


def cutoff(today: dt.date, days: int) -> str:
    # No zone offset. The sink writes `created_at` as an Iceberg `timestamp`,
    # which is zone-free, and PyIceberg refuses to bind a literal that carries
    # one. The values are UTC either way; only the notation differs.
    return (today - dt.timedelta(days=days)).isoformat() + "T00:00:00"


def sql_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def tables(settings: Settings) -> tuple[str, ...]:
    return (settings.table,) if not settings.legacy_table else (settings.table, settings.legacy_table)


def run(
    settings: Settings | None = None,
    catalog: Catalog | None = None,
    today: dt.date | None = None,
) -> int:
    settings = settings or Settings.from_env()
    if catalog is None:
        from pyiceberg.catalog.rest import RestCatalog

        catalog = RestCatalog(
            name="r2",
            warehouse=settings.warehouse,
            uri=settings.catalog_uri,
            token=settings.token,
        )

    result = erase(catalog, settings)
    pruned = prune(catalog, settings, today or dt.datetime.now(dt.timezone.utc).date())
    print(f"done: {result.passes} erasure passes committed, {result.failed} failed")
    return 1 if result.failed or not pruned else 0


def main() -> None:
    raise SystemExit(run())


if __name__ == "__main__":
    main()
