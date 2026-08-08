"""Removes from the audit archive what the gateway cannot remove itself.

R2 SQL is read-only, so a row leaves the Iceberg table only when a transaction
commits through the catalog. The gateway therefore records an intent and this
job carries it out, which is the asynchronous deletion `AUDIT-ARCHITECTURE.md`
describes.

Two jobs in one run, in this order:

1. Erasure. Accounts and projects the gateway was asked to forget. Ordered
   first because somebody is waiting on it and because it is bounded.
2. Retention. Rows older than the window their owner's plan allows.

Nothing here is idempotent by accident. A target is closed only after its
transaction commits, so a run that dies halfway leaves the rest queued rather
than silently dropped, and the next run repeats work that is a no-op.
"""

from __future__ import annotations

import datetime as dt
import json
import os
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass

from pyiceberg.catalog.rest import RestCatalog

TIMEOUT_S = 60


@dataclass(frozen=True)
class Settings:
    catalog_uri: str
    warehouse: str
    token: str
    table: str
    gateway: str
    secret: str

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
            table=os.environ.get("AUDIT_R2_TABLE", "default.tool_calls"),
            gateway=need("GATEWAY_URL").rstrip("/"),
            secret=need("AUDIT_MAINTENANCE_SECRET"),
        )


def gateway_request(settings: Settings, path: str, body: dict | None = None) -> dict:
    request = urllib.request.Request(
        f"{settings.gateway}{path}",
        method="POST" if body is not None else "GET",
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


def erase(catalog: RestCatalog, settings: Settings) -> int:
    """Drains the gateway's deletion queue, one committed transaction at a time."""
    pending = gateway_request(settings, "/internal/audit-deletions").get("items", [])
    if not pending:
        print("nothing to erase")
        return 0

    done = 0
    for item in pending:
        column = "user_id" if item["scope"] == "user" else "project_id"
        target = item["targetId"]
        try:
            table = catalog.load_table(settings.table)
            table.delete(delete_filter=f"{column} == {sql_literal(target)}")
        except Exception as error:  # noqa: BLE001
            # Reported rather than raised: one unerasable target must not stop
            # the queue, and the gateway keeps it pending with the reason.
            print(f"failed {item['scope']} {target}: {type(error).__name__}: {error}")
            settle(settings, item["id"], ok=False, error=f"{type(error).__name__}: {error}")
            continue

        # Only now. Closing a target before its transaction commits would lose
        # the instruction with nothing deleted, and nothing else remembers it.
        settle(settings, item["id"], ok=True)
        done += 1
        print(f"erased {item['scope']} {target}")

    return done


def prune(catalog: RestCatalog, settings: Settings, today: dt.date) -> None:
    """Applies each plan's retention window.

    Two statements, and the shape is inverted on purpose. Everything past the
    longest window goes with no list at all. Sparing the longer-plan accounts
    needs their ids, and those are the small set: paying accounts are a
    fraction of all accounts, so naming them is what scales.
    """
    policy = gateway_request(settings, "/internal/retention")
    table = catalog.load_table(settings.table)

    longest = cutoff(today, policy["longestDays"])
    table.delete(delete_filter=f"created_at < {sql_literal(longest)}")
    print(f"pruned everything before {longest}")

    exempt = policy["exemptUserIds"]
    shortest = cutoff(today, policy["shortestDays"])
    if policy["shortestDays"] == policy["longestDays"]:
        return

    spare = (
        ""
        if not exempt
        else " and " + " and ".join(f"user_id != {sql_literal(user)}" for user in exempt)
    )
    table.delete(delete_filter=f"created_at < {sql_literal(shortest)}{spare}")
    print(f"pruned before {shortest}, sparing {len(exempt)} longer-plan accounts")


def settle(settings: Settings, deletion_id: str, *, ok: bool, error: str = "") -> None:
    body = {"ok": ok} if ok else {"ok": False, "error": error[:500]}
    try:
        gateway_request(settings, f"/internal/audit-deletions/{deletion_id}", body)
    except urllib.error.HTTPError as http_error:
        # 404 means another run already closed it, which is not a problem.
        if http_error.code != 404:
            raise


def cutoff(today: dt.date, days: int) -> str:
    return (today - dt.timedelta(days=days)).isoformat() + "T00:00:00+00:00"


def sql_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def main() -> None:
    settings = Settings.from_env()
    catalog = RestCatalog(
        name="r2",
        warehouse=settings.warehouse,
        uri=settings.catalog_uri,
        token=settings.token,
    )

    erased = erase(catalog, settings)
    prune(catalog, settings, dt.datetime.now(dt.timezone.utc).date())
    print(f"done: {erased} targets erased")


if __name__ == "__main__":
    main()
