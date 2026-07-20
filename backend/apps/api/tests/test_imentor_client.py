"""iMentor client unit testlari."""
from __future__ import annotations

from unittest import mock

from django.test import TestCase

from apps.api.imentor_client import _imentor_global_published_count, imentor_published_test_count


class IMentorClientCountTests(TestCase):
    @mock.patch("apps.api.imentor_client.imentor_list_tests", return_value={"count": 5})
    def test_global_count_from_list_api(self, _list):
        self.assertEqual(_imentor_global_published_count(), 5)
        self.assertEqual(imentor_published_test_count(), 5)

    @mock.patch("apps.api.imentor_client.imentor_catalog_stats", return_value={"count": 0})
    @mock.patch(
        "apps.api.imentor_client.imentor_stats",
        return_value={"by_subject": [{"test_count": 2}, {"test_count": 1}]},
    )
    @mock.patch("apps.api.imentor_client.imentor_list_tests", return_value={"count": 0})
    def test_global_count_fallback_stats_sum(self, _list, _stats, _cat):
        self.assertEqual(_imentor_global_published_count(), 3)

    @mock.patch("apps.api.imentor_client.imentor_list_tests", return_value={"count": 4})
    def test_filtered_subject_uses_list(self, mock_list):
        n = imentor_published_test_count(subject_code="ANAT")
        self.assertEqual(n, 4)
        mock_list.assert_called()
