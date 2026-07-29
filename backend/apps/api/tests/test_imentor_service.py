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
    departments_from_catalog,
    fetch_random_imentor_questions,
    normalize_exam_question_count,
    resolve_imentor_subject_codes,
    subjects_for_department,
    validate_imentor_subjects,
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

    @mock.patch("apps.api.imentor_service._build_subject_registry")
    def test_resolve_subject_codes_case_insensitive(self, mock_registry):
        mock_registry.return_value = {
            "akusherlik-va-ginekologiya": {
                "subject_code": "akusherlik-va-ginekologiya",
                "subject_name": "Akusherlik va ginekologiya",
                "test_count": 2,
            }
        }
        resolved = resolve_imentor_subject_codes(["AKUSHERLIK-VA-GINEKOLOGIYA"])
        self.assertEqual(resolved, ["akusherlik-va-ginekologiya"])

    @mock.patch("apps.api.imentor_service.imentor_published_test_count", return_value=2)
    @mock.patch("apps.api.imentor_service.imentor_configured", return_value=True)
    @mock.patch("apps.api.imentor_service._build_subject_registry")
    def test_validate_imentor_subjects_slug_code(self, mock_registry, _cfg, _count):
        mock_registry.return_value = {
            "akusherlik-va-ginekologiya": {
                "subject_code": "akusherlik-va-ginekologiya",
                "subject_name": "Akusherlik va ginekologiya",
                "test_count": 2,
            }
        }
        ok, err, total = validate_imentor_subjects(["akusherlik-va-ginekologiya"])
        self.assertTrue(ok, err)
        self.assertEqual(total, 2)

    @mock.patch("apps.api.imentor_service.imentor_configured", return_value=True)
    @mock.patch("apps.api.imentor_service.imentor_catalog_departments")
    def test_departments_from_catalog(self, mock_depts, _cfg):
        mock_depts.return_value = {
            "results": [
                {"code": "fiziologiya", "name": "Fiziologiya kafedrasi", "sort_order": 1, "subjects_count": 3},
            ]
        }
        rows = departments_from_catalog()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["code"], "fiziologiya")

    @mock.patch("apps.api.imentor_service.imentor_published_test_count", return_value=0)
    @mock.patch("apps.api.imentor_service._build_subject_registry")
    @mock.patch("apps.api.imentor_service.imentor_configured", return_value=True)
    @mock.patch("apps.api.imentor_service.imentor_collect_department_subjects")
    def test_subjects_for_department_merges_test_count(self, mock_collect, _cfg, mock_registry, _pub):
        mock_collect.return_value = (
            {"code": "fiziologiya", "name": "Fiziologiya kafedrasi"},
            [
                {
                    "subject_code": "fiziologiya__anatomiya",
                    "subject_name": "Anatomiya",
                    "variants_count": 2,
                    "topics_count": 10,
                }
            ],
        )
        mock_registry.return_value = {
            "fiziologiya__anatomiya": {
                "subject_code": "fiziologiya__anatomiya",
                "test_count": 4,
                "questions_total": 60,
            }
        }
        dept, subjects = subjects_for_department("fiziologiya")
        self.assertEqual(dept["code"], "fiziologiya")
        self.assertEqual(len(subjects), 1)
        self.assertEqual(subjects[0]["test_count"], 4)

    @mock.patch("apps.api.imentor_service._build_subject_registry")
    def test_resolve_catalog_code_not_in_registry(self, mock_registry):
        mock_registry.return_value = {}
        resolved = resolve_imentor_subject_codes(
            ["akusherlik-va-ginekologiya__akusherlik-va-ginekologiya-pediatriy"]
        )
        self.assertEqual(
            resolved,
            ["akusherlik-va-ginekologiya__akusherlik-va-ginekologiya-pediatriy"],
        )

    @mock.patch("apps.api.imentor_service.imentor_published_test_count", return_value=3)
    @mock.patch("apps.api.imentor_service.imentor_configured", return_value=True)
    @mock.patch("apps.api.imentor_service._build_subject_registry")
    def test_validate_catalog_subject_with_legacy_department_tests(self, mock_registry, _cfg, _count):
        mock_registry.return_value = {
            "akusherlik-va-ginekologiya": {
                "subject_code": "akusherlik-va-ginekologiya",
                "test_count": 3,
            },
            "akusherlik-va-ginekologiya__pediatriy": {
                "subject_code": "akusherlik-va-ginekologiya__pediatriy",
                "department_code": "akusherlik-va-ginekologiya",
                "test_count": 3,
            },
        }
        ok, err, total = validate_imentor_subjects(
            ["akusherlik-va-ginekologiya__pediatriy"]
        )
        self.assertTrue(ok, err)
        self.assertGreaterEqual(total, 3)

    @mock.patch("apps.api.imentor_service.exam_questions_add_translations", side_effect=lambda q, _lang: q)
    @mock.patch("apps.api.imentor_service.imentor_get_test")
    @mock.patch("apps.api.imentor_service.imentor_collect_tests_for_subject")
    @mock.patch("apps.api.imentor_service.resolve_imentor_subject_codes", return_value=["ANAT"])
    @mock.patch("apps.api.imentor_service.question_limit_bounds", return_value={"min": 10, "max": 30})
    @mock.patch("apps.api.imentor_service._build_subject_registry")
    def test_fetch_random_uses_api_question_limit(self, mock_registry, _bounds, _resolve, mock_collect, mock_get, _tr):
        mock_registry.return_value = {
            "ANAT": {"subject_code": "ANAT", "test_count": 1},
        }
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
        mock_collect.assert_called_with(
            "ANAT",
            syllabus_id=None,
            department_code="ANAT",
            variant_label=None,
            topic_code=None,
            min_questions=10,
            max_questions=30,
        )
        mock_get.assert_called_with(42, question_limit=15)
        self.assertEqual(len(qs), 15)
        self.assertEqual(meta["question_count_returned"], 15)

    @mock.patch("apps.api.imentor_service.exam_questions_add_translations", side_effect=lambda q, _lang: q)
    @mock.patch("apps.api.imentor_service.imentor_get_test")
    @mock.patch("apps.api.imentor_service.imentor_collect_tests_for_subject")
    @mock.patch("apps.api.imentor_service.resolve_imentor_subject_codes", return_value=["ANAT"])
    @mock.patch("apps.api.imentor_service.question_limit_bounds", return_value={"min": 10, "max": 30})
    @mock.patch("apps.api.imentor_service._build_subject_registry")
    def test_fetch_random_all_questions_when_zero(self, mock_registry, _bounds, _resolve, mock_collect, mock_get, _tr):
        mock_registry.return_value = {
            "ANAT": {"subject_code": "ANAT", "test_count": 1},
        }
        mock_collect.return_value = [{"id": 7, "subject_code": "ANAT"}]
        mock_get.return_value = {
            "payload": {
                "questions": [
                    {"question": "Q1", "options": ["A", "B"], "correctOptionIndex": 0},
                ],
            },
        }
        qs, _meta = fetch_random_imentor_questions(["ANAT"], max_questions=0, add_translations=False)
        mock_collect.assert_called_with(
            "ANAT",
            syllabus_id=None,
            department_code="ANAT",
            variant_label=None,
            topic_code=None,
            min_questions=10,
            max_questions=30,
        )
        mock_get.assert_called_with(7, question_limit=None)
        self.assertEqual(len(qs), 1)

    @mock.patch("apps.api.imentor_service.imentor_published_test_count", return_value=0)
    @mock.patch("apps.api.imentor_service._build_subject_registry")
    @mock.patch("apps.api.imentor_service.imentor_configured", return_value=True)
    @mock.patch("apps.api.imentor_service.imentor_collect_department_subjects")
    def test_subjects_for_department_includes_variants(self, mock_collect, _cfg, mock_registry, _pub):
        mock_collect.return_value = (
            {"code": "fiziologiya", "name": "Fiziologiya kafedrasi"},
            [
                {
                    "subject_code": "fiziologiya__anatomiya",
                    "subject_name": "Anatomiya",
                    "variants_count": 1,
                    "topics_count": 1,
                    "variants": [
                        {
                            "label": "PI",
                            "topics": [{"id": "M1", "title": "Yurak"}],
                        }
                    ],
                }
            ],
        )
        mock_registry.return_value = {
            "fiziologiya__anatomiya": {
                "subject_code": "fiziologiya__anatomiya",
                "test_count": 2,
            }
        }
        _dept, subjects = subjects_for_department("fiziologiya")
        self.assertEqual(subjects[0]["variants"][0]["label"], "PI")
        self.assertEqual(subjects[0]["variants"][0]["topics"][0]["code"], "m1")
