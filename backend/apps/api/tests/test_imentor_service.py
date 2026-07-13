"""iMentor servis unit testlari (mock API)."""
from __future__ import annotations

from unittest import mock

from django.test import TestCase

from apps.api.imentor_service import _transform_imentor_questions, subjects_from_stats


class IMentorServiceTests(TestCase):
    def test_transform_imentor_questions_maps_correct_index(self):
        raw = [
            {
                "question": "2+2=?",
                "options": ["3", "4", "5"],
                "correctOptionIndex": 1,
            },
            {
                "question": "Bo'sh",
                "options": [],
                "correctOptionIndex": 0,
            },
        ]
        out = _transform_imentor_questions(raw)
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["text"], "2+2=?")
        self.assertEqual(out[0]["correctAnswer"], "4")

    def test_transform_limits_question_count(self):
        raw = [
            {"question": f"Q{i}", "options": ["A", "B"], "correctOptionIndex": 0}
            for i in range(10)
        ]
        out = _transform_imentor_questions(raw, limit=3)
        self.assertEqual(len(out), 3)

    @mock.patch("apps.api.imentor_service.imentor_configured", return_value=True)
    @mock.patch("apps.api.imentor_service.imentor_stats")
    def test_subjects_from_stats(self, mock_stats, _cfg):
        mock_stats.return_value = {
            "by_subject": [
                {"subject_code": "ANAT", "subject_name": "Anatomiya", "test_count": 5},
            ]
        }
        rows = subjects_from_stats()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["subject_code"], "ANAT")
        self.assertEqual(rows[0]["test_count"], 5)
