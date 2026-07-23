"""
iMentor imtihon yaratish: savollar YARATISHDA olib kelinishi va tarjima qilinishi,
talaba kirganda esa oldindan tayyorlangan (fiksirlangan) to'plamni ishlatishi
(iMentor'ga qayta murojaat qilmasligi) kerak — bu talaba kirishini tezlashtiradi.
"""
from __future__ import annotations

import copy
import json
import os
from unittest import mock

import bcrypt
from django.test import TestCase, override_settings
from django.utils import timezone as dj_tz
from datetime import timedelta
from rest_framework.test import APIClient

from apps.core.models import AppUser, Exam, ExamGroup, Group, Level, StudentExam

PROFILE = (
    "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlcZ/"
    "2wBDAQwSERMWGR8lJx8lPz09Pz09Pz09Pz09Pz09Pz09Pz09Pz09Pz09Pz09Pz09Pz09Pz09Pz09Pz09Pz09Pz09P//wAARCAABAAEDAREAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGQAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//Z"
)

FAKE_QUESTIONS = [
    {"id": 1, "text": "Yurak necha kamerali?", "options": ["2", "3", "4", "5"], "correctAnswer": "4"},
    {"id": 2, "text": "Qon guruhlari nechta?", "options": ["2", "3", "4", "5"], "correctAnswer": "4"},
]


def _rf_throttle_off():
    from django.conf import settings

    rf = copy.deepcopy(settings.REST_FRAMEWORK)
    rf["DEFAULT_THROTTLE_CLASSES"] = []
    rf["DEFAULT_THROTTLE_RATES"] = {k: "100000/h" for k in rf.get("DEFAULT_THROTTLE_RATES", {})}
    return rf


@override_settings(REST_FRAMEWORK=_rf_throttle_off())
class ImentorExamCreateFixedSetTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.level = Level.objects.create(name="iMentor-test level")
        cls.group = Group.objects.create(name="iMentor-test group", level=cls.level)
        hp = bcrypt.hashpw(b"smoke-admin", bcrypt.gensalt(rounds=10)).decode("ascii")
        cls.admin = AppUser.objects.create(
            id="imentor_smoke_admin", password=hp, role="admin", name="Imentor Admin",
            group=None, profile_image=PROFILE, status="Active",
        )
        hp2 = bcrypt.hashpw(b"smoke-student", bcrypt.gensalt(rounds=10)).decode("ascii")
        cls.student = AppUser.objects.create(
            id="imentor_smoke_student", password=hp2, role="student", name="Imentor Student",
            group=cls.group, profile_image=PROFILE, status="Active",
        )

    def setUp(self):
        self._env = mock.patch.dict(
            os.environ,
            {
                "VAC_HMAC_GUARD": "0",
                "VAC_SEQ_GUARD": "0",
                "VAC_CHALLENGE_GUARD": "0",
                "VAC_DEVICE_LOCK": "0",
                "IDENTITY_VERIFY_REQUIRED": "0",
            },
            clear=False,
        )
        self._env.start()
        self.addCleanup(self._env.stop)

        self.admin_client = APIClient()
        r = self.admin_client.post("/api/auth/login", {"id": "imentor_smoke_admin", "password": "smoke-admin"}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.admin_client.credentials(HTTP_AUTHORIZATION=f"Bearer {r.json()['token']}")

    def _iso_window(self, minutes=120):
        start = dj_tz.now() + timedelta(minutes=5)
        return start.isoformat(), (start + timedelta(minutes=minutes)).isoformat()

    @mock.patch("apps.api.imentor_service.fetch_random_imentor_questions")
    @mock.patch("apps.api.imentor_service.resolve_imentor_subject_codes")
    @mock.patch("apps.api.imentor_service.validate_imentor_subjects")
    def test_creation_fetches_and_stores_fixed_question_set(
        self, mock_validate, mock_resolve, mock_fetch,
    ):
        mock_validate.return_value = (True, "", 5)
        mock_resolve.return_value = ["dept__subj"]
        mock_fetch.return_value = (FAKE_QUESTIONS, {"subject_name": "Kardiologiya"})

        start, end = self._iso_window()
        r = self.admin_client.post(
            "/api/admin/exams",
            {
                "title": "iMentor Fixed Exam",
                "start_time": start,
                "end_time": end,
                "duration_minutes": 45,
                "language": "uz",
                "group_ids": [self.group.id],
                "exam_mode": "imentor_mixed",
                "imentor_subject_codes": ["dept__subj"],
                "bank_question_count": 0,
                "exam_exceptions": [],
            },
            format="json",
        )
        self.assertEqual(r.status_code, 200, r.content)
        mock_fetch.assert_called_once()
        exam_id = r.json()["id"]
        exam = Exam.objects.get(pk=exam_id)
        stored = json.loads(exam.questions_json)
        self.assertEqual(len(stored), 2)
        self.assertEqual(stored[0]["text"], "Yurak necha kamerali?")

    @mock.patch("apps.api.imentor_service.fetch_random_imentor_questions")
    @mock.patch("apps.api.imentor_service.resolve_imentor_subject_codes")
    @mock.patch("apps.api.imentor_service.validate_imentor_subjects")
    def test_student_start_uses_fixed_set_without_refetching_imentor(
        self, mock_validate, mock_resolve, mock_fetch,
    ):
        mock_validate.return_value = (True, "", 5)
        mock_resolve.return_value = ["dept__subj"]
        mock_fetch.return_value = (FAKE_QUESTIONS, {"subject_name": "Kardiologiya"})

        # Talaba darhol kira olishi uchun boshlanish vaqti O'TMISHDA (aks holda
        # "Exam has not started yet" bilan bloklanadi).
        now = dj_tz.now()
        start = (now - timedelta(minutes=5)).isoformat()
        end = (now + timedelta(minutes=115)).isoformat()
        r = self.admin_client.post(
            "/api/admin/exams",
            {
                "title": "iMentor Fixed Exam 2",
                "start_time": start, "end_time": end, "duration_minutes": 45,
                "language": "uz", "group_ids": [self.group.id],
                "exam_mode": "imentor_mixed",
                "imentor_subject_codes": ["dept__subj"],
                "bank_question_count": 0,
                "exam_exceptions": [],
            },
            format="json",
        )
        self.assertEqual(r.status_code, 200, r.content)
        exam_id = r.json()["id"]
        ExamGroup.objects.get_or_create(exam_id=exam_id, group_id=self.group.id)
        self.assertEqual(mock_fetch.call_count, 1, "creationda bitta marta chaqirilishi kerak")

        student_client = APIClient()
        student_client.defaults["HTTP_X_DEVICE_FINGERPRINT"] = "imentor-e2e-device-fp"
        rl = student_client.post(
            "/api/auth/login", {"id": "imentor_smoke_student", "password": "smoke-student"}, format="json"
        )
        self.assertEqual(rl.status_code, 200, rl.content)
        student_client.credentials(HTTP_AUTHORIZATION=f"Bearer {rl.json()['token']}")

        rs = student_client.post(f"/api/student/exams/{exam_id}/start", {"pin": ""}, format="json")
        self.assertEqual(rs.status_code, 200, rs.content)
        # MUHIM: talaba kirganda iMentor'ga QAYTA murojaat qilinmasligi kerak —
        # creationda saqlangan fiksirlangan to'plam ishlatiladi (tezlik uchun).
        self.assertEqual(
            mock_fetch.call_count, 1,
            "talaba kirganda iMentor qayta chaqirilmasligi kerak (fiksirlangan to'plam)",
        )
        qs = rs.json()["exam"]["questions"]
        self.assertEqual(len(qs), 2)

        se = StudentExam.objects.get(student_id=self.student.id, exam_id=exam_id)
        self.assertTrue(se.session_questions_json)

    @mock.patch("apps.api.imentor_service.fetch_random_imentor_questions")
    @mock.patch("apps.api.imentor_service.resolve_imentor_subject_codes")
    @mock.patch("apps.api.imentor_service.validate_imentor_subjects")
    def test_creation_fails_cleanly_when_imentor_fetch_errors(
        self, mock_validate, mock_resolve, mock_fetch,
    ):
        from apps.api.imentor_client import IMentorApiError

        mock_validate.return_value = (True, "", 5)
        mock_resolve.return_value = ["dept__subj"]
        mock_fetch.side_effect = IMentorApiError("Test topilmadi", status=404)

        start, end = self._iso_window()
        r = self.admin_client.post(
            "/api/admin/exams",
            {
                "title": "iMentor Fail Exam",
                "start_time": start, "end_time": end, "duration_minutes": 45,
                "language": "uz", "group_ids": [self.group.id],
                "exam_mode": "imentor_mixed",
                "imentor_subject_codes": ["dept__subj"],
                "bank_question_count": 0,
                "exam_exceptions": [],
            },
            format="json",
        )
        self.assertEqual(r.status_code, 400, r.content)
        self.assertFalse(Exam.objects.filter(title="iMentor Fail Exam").exists())
