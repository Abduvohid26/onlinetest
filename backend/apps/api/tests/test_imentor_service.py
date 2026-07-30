"""iMentor servis unit testlari (mock API)."""
from __future__ import annotations

from unittest import mock

from django.test import SimpleTestCase

from apps.api.imentor_client import (
    DEFAULT_QUESTION_LIMIT_BOUNDS,
    parse_question_limit_bounds,
    validate_question_limit_value,
    IMentorApiError,
)
from apps.api.imentor_service import (
    _apply_imentor_builtin_translations,
    _transform_imentor_questions,
    departments_from_catalog,
    fetch_random_imentor_questions,
    normalize_exam_question_count,
    resolve_imentor_subject_codes,
    subjects_for_department,
    validate_imentor_subjects,
)


class IMentorServiceTests(SimpleTestCase):
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

    def test_apply_imentor_builtin_translations_skips_ai_when_complete(self):
        base = _transform_imentor_questions(
            [{"question": "Savol uz?", "options": ["A", "B"], "correctOptionIndex": 0}]
        )
        payload = {
            "questions": [{"question": "Savol uz?", "options": ["A", "B"], "correctOptionIndex": 0}],
            "translations": {
                "ru": {
                    "questions": [
                        {"question": "Вопрос ru?", "options": ["А", "Б"], "correctOptionIndex": 0}
                    ]
                },
                "en": {
                    "questions": [
                        {"question": "Question en?", "options": ["A", "B"], "correctOptionIndex": 0}
                    ]
                },
            },
        }
        merged, complete = _apply_imentor_builtin_translations(base, payload)
        self.assertTrue(complete)
        self.assertEqual(merged[0]["text_uz"], "Savol uz?")
        self.assertEqual(merged[0]["text_ru"], "Вопрос ru?")
        self.assertEqual(merged[0]["text_en"], "Question en?")
        self.assertEqual(merged[0]["options_ru"], ["А", "Б"])

    @mock.patch("apps.api.imentor_service.exam_questions_add_translations", side_effect=lambda q, _lang: q)
    @mock.patch("apps.api.imentor_service.imentor_sample_questions")
    @mock.patch("apps.api.imentor_service.resolve_imentor_subject_codes", return_value=["ANAT"])
    @mock.patch("apps.api.imentor_service.question_limit_bounds", return_value={"min": 10, "max": 30})
    @mock.patch("apps.api.imentor_service._build_subject_registry")
    def test_fetch_sample_adds_translations_via_ai(
        self, mock_registry, _bounds, _resolve, mock_sample, mock_ai
    ):
        mock_registry.return_value = {"ANAT": {"subject_code": "ANAT", "test_count": 1}}
        mock_sample.return_value = {
            "subject_code": "ANAT",
            "count_available": 1,
            "count_returned": 1,
            "tests_scanned": 1,
            "question_limit_bounds": {"min": 10, "max": 30},
            "questions": [
                {"question": "Savol?", "options": ["A", "B"], "correctOptionIndex": 0}
            ],
        }
        qs, meta = fetch_random_imentor_questions(["ANAT"], max_questions=10, add_translations=True)
        mock_ai.assert_called_once()
        self.assertEqual(meta["translations_source"], "ai")
        self.assertTrue(meta.get("imentor_sample"))
        self.assertEqual(qs[0]["text"], "Savol?")

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
    @mock.patch("apps.api.imentor_service.imentor_sample_questions")
    @mock.patch("apps.api.imentor_service.resolve_imentor_subject_codes", return_value=["ANAT"])
    @mock.patch("apps.api.imentor_service.question_limit_bounds", return_value={"min": 10, "max": 30})
    @mock.patch("apps.api.imentor_service._build_subject_registry")
    def test_fetch_random_uses_api_question_limit(self, mock_registry, _bounds, _resolve, mock_sample, _tr):
        mock_registry.return_value = {
            "ANAT": {"subject_code": "ANAT", "test_count": 1},
        }
        mock_sample.return_value = {
            "subject_code": "ANAT",
            "department_code": "ANAT",
            "count_requested": 15,
            "count_available": 25,
            "count_returned": 15,
            "tests_scanned": 3,
            "question_limit_bounds": {"min": 10, "max": 30},
            "questions": [
                {
                    "question": f"Q{i}",
                    "options": ["A", "B"],
                    "correctOptionIndex": 0,
                    "references": [{"title": "Kitob", "pages": "1"}],
                }
                for i in range(15)
            ],
        }
        qs, meta = fetch_random_imentor_questions(["ANAT"], max_questions=15, add_translations=False)
        mock_sample.assert_called_with(
            subject_code="ANAT",
            department_code="ANAT",
            count=15,
            variant_label=None,
            topic_code=None,
            syllabus_id=None,
        )
        self.assertEqual(len(qs), 15)
        self.assertEqual(meta["question_count_returned"], 15)
        self.assertEqual(meta["tests_scanned"], 3)
        self.assertEqual(qs[0]["references"][0]["title"], "Kitob")

    @mock.patch("apps.api.imentor_service.exam_questions_add_translations", side_effect=lambda q, _lang: q)
    @mock.patch("apps.api.imentor_service.imentor_sample_questions")
    @mock.patch("apps.api.imentor_service.resolve_imentor_subject_codes", return_value=["ANAT"])
    @mock.patch("apps.api.imentor_service.question_limit_bounds", return_value={"min": 10, "max": 30})
    @mock.patch("apps.api.imentor_service._build_subject_registry")
    def test_fetch_random_all_questions_when_zero(self, mock_registry, _bounds, _resolve, mock_sample, _tr):
        mock_registry.return_value = {
            "ANAT": {"subject_code": "ANAT", "test_count": 1},
        }
        mock_sample.return_value = {
            "count_available": 1,
            "count_returned": 1,
            "questions": [
                {"question": "Q1", "options": ["A", "B"], "correctOptionIndex": 0},
            ],
        }
        qs, _meta = fetch_random_imentor_questions(["ANAT"], max_questions=0, add_translations=False)
        mock_sample.assert_called_with(
            subject_code="ANAT",
            department_code="ANAT",
            count=None,
            variant_label=None,
            topic_code=None,
            syllabus_id=None,
        )
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
