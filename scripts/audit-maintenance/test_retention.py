import datetime as dt
import unittest
from unittest import mock

import main as maintenance


class RollingRetentionTests(unittest.TestCase):
    def test_one_day_means_24_hours_not_previous_midnight(self):
        now = dt.datetime(2026, 9, 23, 15, 42, 31, tzinfo=dt.timezone.utc)
        self.assertEqual(maintenance.cutoff(now, 1), "2026-09-22T15:42:31")

    def test_converts_offset_to_utc_before_removing_the_zone(self):
        mexico = dt.timezone(dt.timedelta(hours=-6))
        now = dt.datetime(2026, 9, 23, 23, 42, 31, tzinfo=mexico)
        self.assertEqual(maintenance.cutoff(now, 1), "2026-09-23T05:42:31")

    def test_keeps_deterministic_date_callers_compatible(self):
        self.assertEqual(maintenance.cutoff(dt.date(2026, 9, 23), 1), "2026-09-22T00:00:00")

    def test_rejects_naive_datetimes(self):
        with self.assertRaises(ValueError):
            maintenance.cutoff(dt.datetime(2026, 9, 23, 15), 1)

    def test_rejects_invalid_retention(self):
        for days in (0, -1, 0.5, True):
            with self.subTest(days=days), self.assertRaises(ValueError):
                maintenance.cutoff(dt.date(2026, 9, 23), days)

    def test_prune_uses_rolling_cutoffs_and_spares_pro_accounts(self):
        catalog = mock.Mock()
        settings = mock.Mock(legacy_table=None, table="default.tool_calls")
        policy = {
            "shortestDays": 1,
            "longestDays": 365,
            "exemptUserIds": ["usr_pro"],
            "rollup": {"pruneAllowed": True},
        }
        now = dt.datetime(2026, 9, 23, 15, 42, tzinfo=dt.timezone.utc)
        with mock.patch.object(maintenance, "gateway_request", return_value=policy):
            self.assertTrue(maintenance.prune(catalog, settings, now))
        self.assertEqual(
            catalog.load_table.return_value.delete.call_args_list[1].kwargs["delete_filter"],
            "created_at < '2026-09-22T15:42:00' and user_id != 'usr_pro'",
        )

    def test_never_deletes_unrolled_audit_for_a_shorter_retention_window(self):
        catalog = mock.Mock()
        policy = {"rollup": {"pruneAllowed": False, "error": "rollup unavailable"}}
        with mock.patch.object(maintenance, "gateway_request", return_value=policy):
            self.assertFalse(maintenance.prune(catalog, mock.Mock(), dt.date(2026, 9, 23)))
        catalog.load_table.assert_not_called()


if __name__ == "__main__":
    unittest.main()
