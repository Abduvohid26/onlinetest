"""Qoidabuzarlik limitida qayta topshirish."""
from datetime import timedelta

from apps.api.proctor_exam_retake import (
    IDENTITY_VIOLATION_TYPE,
    try_apply_exam_retake,
    violation_retakes_remaining,
    identity_retakes_remaining,
)
from apps.core.models import AppUser, Exam, ExamGroup, Group, Level, StudentExam
from django.test import TestCase
from django.utils import timezone as dj_tz


class ExamRetakeTests(TestCase):
    def setUp(self):
        level = Level.objects.create(name="L1")
        group = Group.objects.create(name="G1", level=level)
        self.teacher = AppUser.objects.create(
            id="t1", name="Teacher", role="staff", password="x", status="Active"
        )
        self.student = AppUser.objects.create(
            id="s1",
            name="Student",
            role="student",
            password="x",
            status="Active",
            group=group,
        )
        now = dj_tz.now()
        self.exam = Exam.objects.create(
            teacher=self.teacher,
            title="Retake test",
            start_time=now - timedelta(hours=1),
            end_time=now + timedelta(hours=2),
            duration_minutes=60,
            technical_retakes_allowed=3,
            identity_retakes_allowed=1,
        )
        ExamGroup.objects.create(exam=self.exam, group=group)
        self.se = StudentExam.objects.create(
            student=self.student,
            exam=self.exam,
            status="In Progress",
            started_at=now,
            proctor_official_warnings=2,
        )

    def test_violation_retake_any_type(self):
        payload = try_apply_exam_retake(
            self.se,
            self.exam,
            reason_text="Tab switch",
            violations_count=3,
            violation_type="TAB_SWITCH_HARD",
        )
        self.assertIsNotNone(payload)
        self.assertTrue(payload["examRetake"])
        self.se.refresh_from_db()
        self.assertEqual(self.se.status, "Pending")
        self.assertEqual(self.se.technical_retakes_used, 1)
        self.assertEqual(violation_retakes_remaining(self.se, self.exam), 2)

    def test_identity_retake_once(self):
        payload = try_apply_exam_retake(
            self.se,
            self.exam,
            reason_text="Identity",
            violations_count=1,
            violation_type=IDENTITY_VIOLATION_TYPE,
        )
        self.assertIsNotNone(payload)
        self.assertTrue(payload["examRetake"])
        self.assertTrue(payload["identityRetake"])
        self.assertFalse(payload.get("banned"))
        self.se.refresh_from_db()
        self.assertEqual(self.se.identity_retakes_used, 1)
        self.assertEqual(self.se.status, "Pending")
        self.assertEqual(identity_retakes_remaining(self.se, self.exam), 0)

        payload2 = try_apply_exam_retake(
            self.se,
            self.exam,
            reason_text="Identity again",
            violations_count=2,
            violation_type=IDENTITY_VIOLATION_TYPE,
        )
        self.assertIsNone(payload2)

    def test_violation_last_retake_bans(self):
        self.se.technical_retakes_used = 2
        self.se.save(update_fields=["technical_retakes_used"])
        payload = try_apply_exam_retake(
            self.se,
            self.exam,
            reason_text="Final strike",
            violations_count=5,
            violation_type="HAND_GESTURE_SUSPECTED",
        )
        self.assertIsNotNone(payload)
        self.assertTrue(payload["banned"])
        self.assertFalse(payload.get("examRetake"))
        self.se.refresh_from_db()
        self.assertEqual(self.se.technical_retakes_used, 3)
        self.assertEqual(self.se.status, "Banned")
        self.assertEqual(self.se.ban_reason, "RETAKE_EXHAUSTED")
        self.assertEqual(violation_retakes_remaining(self.se, self.exam), 0)
