import datetime as dt
import unittest
from unittest import mock

import main as maintenance


SETTINGS = maintenance.Settings(
    catalog_uri="https://catalog.example",
    warehouse="warehouse",
    token="token",
    table="default.tool_calls",
    gateway="https://gateway.example",
    secret="secret",
    legacy_table=None,
)


class FakeTable:
    def __init__(self, error: Exception | None = None):
        self.error = error
        self.filters: list[str] = []

    def delete(self, *, delete_filter: str) -> None:
        self.filters.append(delete_filter)
        if self.error:
            raise self.error


class FakeCatalog:
    def __init__(self, table: FakeTable | None = None):
        self.table = table or FakeTable()
        self.loads = 0

    def load_table(self, _table: str) -> FakeTable:
        self.loads += 1
        return self.table


class AuditMaintenanceTests(unittest.TestCase):
    def test_erase_claims_a_lease_and_returns_it_when_settling(self) -> None:
        requests: list[tuple[str, dict | None, str | None]] = []

        def request(_settings, path, body=None, *, method=None):
            requests.append((path, body, method))
            if path.endswith("/claim"):
                return {
                    "items": [
                        {
                            "id": "adl_one",
                            "scope": "project",
                            "targetId": "prj_one",
                            "leaseToken": "lsh_one",
                        }
                    ]
                }
            return {"ok": True}

        with mock.patch.object(maintenance, "gateway_request", side_effect=request):
            result = maintenance.erase(FakeCatalog(), SETTINGS)

        self.assertEqual(result, maintenance.EraseResult(passes=1, failed=0))
        self.assertEqual(requests[0], ("/internal/audit-deletions/claim", None, "POST"))
        self.assertEqual(
            requests[1][1],
            {"ok": True, "leaseToken": "lsh_one"},
        )

    def test_erase_reports_each_catalog_failure_and_keeps_running(self) -> None:
        responses = [
            {
                "items": [
                    {
                        "id": "adl_one",
                        "scope": "user",
                        "targetId": "usr_one",
                        "leaseToken": "lsh_one",
                    }
                ]
            },
            {"ok": True},
        ]
        with mock.patch.object(maintenance, "gateway_request", side_effect=responses) as request:
            result = maintenance.erase(FakeCatalog(FakeTable(RuntimeError("catalog down"))), SETTINGS)

        self.assertEqual(result, maintenance.EraseResult(passes=0, failed=1))
        self.assertEqual(request.call_args_list[1].args[2]["leaseToken"], "lsh_one")
        self.assertFalse(request.call_args_list[1].args[2]["ok"])

    def test_prune_pauses_when_the_usage_rollup_is_not_caught_up(self) -> None:
        catalog = FakeCatalog()
        policy = {
            "shortestDays": 90,
            "longestDays": 365,
            "exemptUserIds": [],
            "rollup": {
                "lastCompleteDay": "2026-01-01",
                "targetDay": "2026-02-01",
                "backlogDays": 31,
                "pruneAllowed": False,
            },
        }
        with mock.patch.object(maintenance, "gateway_request", return_value=policy):
            self.assertFalse(maintenance.prune(catalog, SETTINGS, dt.date(2026, 2, 2)))
        self.assertEqual(catalog.loads, 0)

    def test_prune_applies_both_retention_tiers_after_rollup(self) -> None:
        catalog = FakeCatalog()
        policy = {
            "shortestDays": 90,
            "longestDays": 365,
            "exemptUserIds": ["usr_pro"],
            "rollup": {"pruneAllowed": True},
        }
        with mock.patch.object(maintenance, "gateway_request", return_value=policy):
            self.assertTrue(maintenance.prune(catalog, SETTINGS, dt.date(2026, 8, 12)))

        self.assertEqual(len(catalog.table.filters), 2)
        self.assertIn("user_id != 'usr_pro'", catalog.table.filters[1])

    def test_run_exits_nonzero_when_retention_is_paused(self) -> None:
        catalog = FakeCatalog()
        responses = [
            {"items": []},
            {
                "shortestDays": 90,
                "longestDays": 365,
                "exemptUserIds": [],
                "rollup": {"pruneAllowed": False, "error": "rollup unavailable"},
            },
        ]
        with mock.patch.object(maintenance, "gateway_request", side_effect=responses):
            self.assertEqual(maintenance.run(SETTINGS, catalog, dt.date(2026, 8, 12)), 1)


if __name__ == "__main__":
    unittest.main()
