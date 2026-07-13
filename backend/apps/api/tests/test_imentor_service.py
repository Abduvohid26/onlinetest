"""iMentor servis unit testlari (mock API)."""
from __future__ import annotations

from unittest import mock

from django.test import TestCase

from apps.api.imentor_client import (
    DEFAULT_QUESTION_LIMIT_BOUNDS,
    parse_question_limit_bounds,
    validate_question_limit_value,
    IMentorApiError,
)
from apps.api.imentor_service import (
    _transform_imentor_questions,
    fetch_random_imentor_questions,
    normalize_exam_question_count,
    subjects_from_stats,
)


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

    def test_parse_question_limit_bounds_defaults(self):
        self.assertEqual(parse_question_limit_bounds({}), DEFAULT_QUESTION_LIMIT_BOUNDS)
        self.assertEqual(
            parse_question_limit_bounds({"question_limit_bounds": {"min": 10, "max": 30}}),
            {"min": 10, "max": 30},
        )

    def test_validate_question_limit_value(self):
        self.assertEqual(validate_question_limit_value(0), 0)
        self.assertEqual(validate_question_limit_value(15), 15)
        with self.assertRaises(IMentorApiError):
            validate_question_limit_value(5)
        with self.assertRaises(IMentorApiError):
            validate_question_limit_value(40)

    def test_normalize_exam_question_count(self):
        self.assertEqual(normalize_exam_question_count(0), 0)
        self.assertEqual(normalize_exam_question_count(20), 20)
        with self.assertRaises(IMentorApiError):
            normalize_exam_question_count(8)

    @mock.patch("apps.api.imentor_service.imentor_configured", return_value=True)
    @mock.patch("apps.api.imentor_service.imentor_stats")
    def test_subjects_from_stats(self, mock_stats, _cfg):
        mock_stats.return_value = {
            "by_subject": [
                {"subject_code": "ANAT", "subject_name": "Anatomiya", "test_count": 5},
            ],
            "question_limit_bounds": {"min": 10, "max": 30},
        }
        rows = subjects_from_stats()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["subject_code"], "ANAT")
        self.assertEqual(rows[0]["test_count"], 5)

    @mock.patch("apps.api.imentor_service.exam_questions_add_translations", side_effect=lambda q, _lang: q)
    @mock.patch("apps.api.imentor_service.imentor_get_test")
    @mock.patch("apps.api.imentor_service.imentor_collect_tests_for_subject")
    @mock.patch("apps.api.imentor_service.question_limit_bounds", return_value={"min": 10, "max": 30})
    def test_fetch_random_uses_api_question_limit(self, _bounds, mock_collect, mock_get, _tr):
        mock_collect.return_value = [{"id": 42, "subject_code": "ANAT", "topic": "T"}]
        mock_get.return_value = {
            "topic": "T",
            "subject_code": "ANAT",
            "question_limit": 15,
            "question_count_available": 25,
            "question_count_returned": 15,
            "question_limit_bounds": {"min": 10, "max": 30},
            "payload": {
                "questions": [
                    {"question": f"Q{i}", "options": ["A", "B"], "correctOptionIndex": 0}
                    for i in range(15)
                ],
            },
        }
        qs, meta = fetch_random_imentor_questions(["ANAT"], max_questions=15, add_translations=False)
        mock_collect.assert_called_with("ANAT", min_questions=15, max_questions=30)
        mock_get.assert_called_with(42, question_limit=15)
        self.assertEqual(len(qs), 15)
        self.assertEqual(meta["question_count_returned"], 15)

    @mock.patch("apps.api.imentor_service.exam_questions_add_translations", side_effect=lambda q, _lang: q)
    @mock.patch("apps.api.imentor_service.imentor_get_test")
    @mock.patch("apps.api.imentor_service.imentor_collect_tests_for_subject")
    @mock.patch("apps.api.imentor_service.question_limit_bounds", return_value={"min": 10, "max": 30})
    def test_fetch_random_all_questions_when_zero(self, _bounds, mock_collect, mock_get, _tr):
        mock_collect.return_value = [{"id": 7, "subject_code": "ANAT"}]
        mock_get.return_value = {
            "payload": {
                "questions": [
                    {"question": "Q1", "options": ["A", "B"], "correctOptionIndex": 0},
                ],
            },
        }
        qs, _meta = fetch_random_imentor_questions(["ANAT"], max_questions=0, add_translations=False)
        mock_collect.assert_called_with("ANAT", min_questions=10, max_questions=30)
        mock_get.assert_called_with(7, question_limit=None)
        self.assertEqual(len(qs), 1)
