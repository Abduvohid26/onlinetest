"""Admin panel smoke testlari — test_baza fayli bilan."""
from __future__ import annotations

import json
import os
from datetime import timedelta
from pathlib import Path
from unittest import mock

import bcrypt
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.utils import timezone as dj_tz
from rest_framework.test import APIClient

from apps.core.models import AppUser, Exam, Group, Level, TestBankCategory

ROOT = Path(__file__).resolve().parents[4]
TEST_BAZA = ROOT / "test_baza"

PROFILE = (
    "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlcZ/"
    "2wBDAQwSERMWGR8lJx8lPz09Pz09Pz09Pz09Pz09Pz09Pz09Pz09Pz09Pz09Pz09Pz09Pz09Pz09Pz09Pz09Pz09P//wAARCAABAAEDAREAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGQAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//Z"
)


def _rf_throttle_off():
    from django.conf import settings
    import copy

    rf = copy.deepcopy(settings.REST_FRAMEWORK)
    rf["DEFAULT_THROTTLE_CLASSES"] = []
    rf["DEFAULT_THROTTLE_RATES"] = {
        "login": "100000/h",
        "face_verify": "100000/h",
        "public_verify": "100000/h",
        "anon": "100000/h",
        "user": "100000/h",
        "exam_autosave": "100000/h",
        "bank_ai_import": "100000/h",
        "violations": "100000/h",
    }
    return rf


@override_settings(REST_FRAMEWORK=_rf_throttle_off())
class AdminSmokeTests(TestCase):
    """Admin: test_baza import, imtihon yaratish (manual/bank), tahrirlash."""

    @classmethod
    def setUpTestData(cls):
        cls.level = Level.objects.create(name="Smoke level")
        cls.group = Group.objects.create(name="Smoke group", level=cls.level)
        hp = bcrypt.hashpw(b"smoke-admin", bcrypt.gensalt(rounds=10)).decode("ascii")
        cls.admin = AppUser.objects.create(
            id="smoke_admin",
            password=hp,
            role="admin",
            name="Smoke Admin",
            group=None,
            profile_image=PROFILE,
            status="Active",
        )

    def setUp(self):
        self.client = APIClient()
        r = self.client.post(
            "/api/auth/login",
            {"id": "smoke_admin", "password": "smoke-admin"},
            format="json",
        )
        self.assertEqual(r.status_code, 200, r.content)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {r.json()['token']}")
        self._created_exam_ids: list[int] = []
        self._created_cat_ids: list[int] = []

    def tearDown(self):
        Exam.objects.filter(id__in=self._created_exam_ids).delete()
        TestBankCategory.objects.filter(id__in=self._created_cat_ids).delete()

    def _iso_window(self, minutes: int = 120) -> tuple[str, str]:
        start = dj_tz.now() + timedelta(minutes=5)
        end = start + timedelta(minutes=minutes)
        return start.isoformat(), end.isoformat()

    def test_admin_meta_endpoints(self):
        for path in (
            "/api/admin/stats",
            "/api/admin/levels",
            "/api/admin/groups",
            "/api/admin/users?role=staff",
            "/api/admin/test-bank/categories",
            "/api/admin/exams",
        ):
            r = self.client.get(path)
            self.assertEqual(r.status_code, 200, path)

    @mock.patch("apps.api.views.admin.translate_questions_batch")
    @mock.patch("apps.api.views.admin.parse_and_classify_questionnaire")
    @mock.patch("apps.api.views.admin.parse_and_classify_document_bytes")
    def test_test_baza_import_and_bank_exam(self, mock_doc, mock_chunk, mock_translate):
        docx = list(TEST_BAZA.glob("*.docx"))
        self.assertTrue(docx, f"test_baza da docx yo'q: {TEST_BAZA}")
        mock_chunk.return_value = [
            {
                "text": "Dermatologiya savol 1?",
                "options": ["A", "B", "C", "D"],
                "correctAnswer": "A",
                "categoryName": "SmokeTestBaza",
            },
            {
                "text": "Dermatologiya savol 2?",
                "options": ["A", "B", "C", "D"],
                "correctAnswer": "B",
                "categoryName": "SmokeTestBaza",
            },
        ]
        mock_doc.return_value = []
        mock_translate.return_value = [{}, {}]
        with open(docx[0], "rb") as fh:
            r = self.client.post(
                "/api/admin/test-bank/import-smart",
                {
                    "collection_name": "SmokeTestBaza",
                    "language": "auto",
                    "file": SimpleUploadedFile(docx[0].name, fh.read()),
                },
                format="multipart",
            )
        self.assertEqual(r.status_code, 200, r.content)
        data = r.json()
        self.assertGreaterEqual(data.get("inserted", 0), 1)
        cat = TestBankCategory.objects.filter(name__startswith="SmokeTestBaza").first()
        self.assertIsNotNone(cat)
        assert cat is not None
        self._created_cat_ids.append(cat.id)

        start, end = self._iso_window(120)
        r2 = self.client.post(
            "/api/admin/exams",
            {
                "title": "Smoke Bank Exam",
                "start_time": start,
                "end_time": end,
                "duration_minutes": 45,
                "language": "uz",
                "group_ids": [self.group.id],
                "exam_mode": "bank_mixed",
                "bank_category_ids": [cat.id],
                "bank_question_count": 2,
                "exam_exceptions": [],
            },
            format="json",
        )
        self.assertEqual(r2.status_code, 200, r2.content)
        eid = r2.json().get("id")
        self.assertIsNotNone(eid)
        self._created_exam_ids.append(int(eid))

    def test_manual_exam_create_edit_delete(self):
        start, end = self._iso_window(90)
        r = self.client.post(
            "/api/admin/exams",
            {
                "title": "Smoke Manual Exam",
                "start_time": start,
                "end_time": end,
                "duration_minutes": 30,
                "language": "uz",
                "group_ids": [self.group.id],
                "manual_questions": json.dumps(
                    [{"id": 1, "text": "1+1?", "options": ["1", "2", "3", "4"], "correctAnswer": "2"}]
                ),
            },
            format="json",
        )
        self.assertEqual(r.status_code, 200, r.content)
        eid = int(r.json()["id"])
        self._created_exam_ids.append(eid)

        g = self.client.get(f"/api/admin/exams/{eid}")
        self.assertEqual(g.status_code, 200)
        self.assertEqual(g.json().get("title"), "Smoke Manual Exam")

        start2, end2 = self._iso_window(100)
        p = self.client.patch(
            f"/api/admin/exams/{eid}",
            {
                "title": "Smoke Manual Exam (edited)",
                "start_time": start2,
                "end_time": end2,
                "duration_minutes": 30,
                "language": "uz",
                "group_ids": [self.group.id],
            },
            format="json",
        )
        self.assertEqual(p.status_code, 200, p.content)

        d = self.client.delete(f"/api/admin/exams/{eid}")
        self.assertEqual(d.status_code, 200)
        self._created_exam_ids.remove(eid)
