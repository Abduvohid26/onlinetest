"""Server-side stale-session sweep (Celery beat task) — mustaqil unit testlar."""
from __future__ import annotations

import json
import os
from datetime import timedelta
from unittest import mock

import bcrypt
from django.test import TestCase
from django.utils import timezone as dj_tz

from apps.api.tasks import run_sweep_stale_sessions
from apps.core.models import AppUser, Exam, Group, Level, StudentExam, ViolationLog

QUESTIONS = [{"id": 1, "text": "2+2=?", "options": ["3", "4"], "correctAnswer": "4"}]


class ProctorSweepTests(TestCase):
    def setUp(self):
        self.level = Level.objects.create(name="Sweep level")
        self.group = Group.objects.create(name="Sweep group", level=self.level)
        hp = bcrypt.hashpw(b"pass", bcrypt.gensalt(rounds=4)).decode("ascii")
        self.admin = AppUser.objects.create(
            id="sweep_admin", password=hp, role="admin", name="Admin", status="Active",
            group_id=self.group.id, profile_image="",
        )
        self.student = AppUser.objects.create(
            id="sweep_student", password=hp, role="student", name="Sweep Student",
            status="Active", group_id=self.group.id, profile_image="",
        )
        now = dj_tz.now()
        self.exam = Exam.objects.create(
            teacher_id=self.admin.id,
            title="Sweep exam",
            start_time=now - timedelta(minutes=10),
            end_time=now + timedelta(hours=1),
            duration_minutes=45,
            questions_json=json.dumps(QUESTIONS),
            language="uz",
        )

    def _make_session(self, *, started_at, proctor_last_frame_at=None, status="In Progress") -> StudentExam:
        return StudentExam.objects.create(
            student_id=self.student.id,
            exam_id=self.exam.id,
            status=status,
            started_at=started_at,
            proctor_last_frame_at=proctor_last_frame_at,
        )

    def test_stale_frame_gap_flags_session(self):
        now = dj_tz.now()
        se = self._make_session(
            started_at=now - timedelta(minutes=5),
            proctor_last_frame_at=now - timedelta(seconds=200),
        )
        out = run_sweep_stale_sessions()
        self.assertEqual(out["flagged"], 1)
        se.refresh_from_db()
        self.assertEqual(se.proctor_official_warnings, 1)
        self.assertEqual(
            ViolationLog.objects.filter(student_id=self.student.id, exam_id=self.exam.id, violation_type="PROCTOR_FEED_LOST").count(),
            1,
        )

    def test_never_received_frame_past_startup_grace_flags_session(self):
        now = dj_tz.now()
        self._make_session(started_at=now - timedelta(seconds=200), proctor_last_frame_at=None)
        out = run_sweep_stale_sessions()
        self.assertEqual(out["flagged"], 1)

    def test_within_startup_grace_not_flagged(self):
        now = dj_tz.now()
        self._make_session(started_at=now - timedelta(seconds=10), proctor_last_frame_at=None)
        out = run_sweep_stale_sessions()
        self.assertEqual(out["flagged"], 0)

    def test_fresh_frame_not_flagged(self):
        now = dj_tz.now()
        self._make_session(
            started_at=now - timedelta(minutes=5),
            proctor_last_frame_at=now - timedelta(seconds=5),
        )
        out = run_sweep_stale_sessions()
        self.assertEqual(out["flagged"], 0)

    def test_completed_session_not_flagged(self):
        now = dj_tz.now()
        self._make_session(
            started_at=now - timedelta(minutes=5),
            proctor_last_frame_at=now - timedelta(seconds=200),
            status="Completed",
        )
        out = run_sweep_stale_sessions()
        self.assertEqual(out["flagged"], 0)

    def test_stale_attempt_timestamp_from_previous_session_not_falsely_flagged(self):
        """proctor_last_frame_at eski attempt'dan qolgan bo'lsa (started_at'dan oldin),
        yangi (hali kadr kelmagan) urinish uchun stale-frame yo'li bo'yicha
        noto'g'ri flag qilinmasligi kerak — faqat startup-grace yo'li ishlaydi."""
        now = dj_tz.now()
        se = self._make_session(
            started_at=now - timedelta(seconds=10),  # startup grace ichida
            proctor_last_frame_at=now - timedelta(minutes=30),  # eski attempt'dan qolgan
        )
        out = run_sweep_stale_sessions()
        self.assertEqual(out["flagged"], 0)
        se.refresh_from_db()
        self.assertEqual(se.proctor_official_warnings, 0)

    @mock.patch.dict(os.environ, {"PROCTOR_SWEEP_RELOG_MINUTES": "5"}, clear=False)
    def test_relog_window_prevents_duplicate_log_on_repeated_sweep(self):
        now = dj_tz.now()
        self._make_session(
            started_at=now - timedelta(minutes=5),
            proctor_last_frame_at=now - timedelta(seconds=200),
        )
        out1 = run_sweep_stale_sessions()
        self.assertEqual(out1["flagged"], 1)
        out2 = run_sweep_stale_sessions()
        self.assertEqual(out2["flagged"], 0)
        self.assertEqual(
            ViolationLog.objects.filter(student_id=self.student.id, exam_id=self.exam.id, violation_type="PROCTOR_FEED_LOST").count(),
            1,
        )

    @mock.patch.dict(
        os.environ,
        {"PROCTOR_SWEEP_RELOG_MINUTES": "5", "PROCTOR_MAX_WARNINGS_BEFORE_BAN": "4"},
        clear=False,
    )
    def test_four_sweeps_apart_bans_session(self):
        """3 ogohlantirish, 4-chi PROCTOR_FEED_LOST da ban.

        Bu test o'z tuzilishi bo'yicha 4 sweep = 3 ogohlantirish + 4-da ban, ya'ni
        max_warnings=4 stsenariysini tekshiradi (default 3 emas — u holda 3-da ban
        bo'lardi; buni PROCTOR_MAX_WARNINGS_BEFORE_BAN=4 bilan aniq beramiz). Shuningdek
        retake-siz (strict) imtihon: aks holda 4-ogohlantirishda ban o'rniga texnik
        retake beriladi, shu sabab retake o'chiriladi.
        """
        now = dj_tz.now()
        Exam.objects.filter(pk=self.exam.id).update(
            technical_retakes_allowed=0, identity_retakes_allowed=0
        )
        se = self._make_session(
            started_at=now - timedelta(hours=1),
            proctor_last_frame_at=now - timedelta(seconds=200),
        )
        for i in range(4):
            run_sweep_stale_sessions()
            se.refresh_from_db()
            if i < 3:
                self.assertEqual(se.status, "In Progress", msg=f"sweep {i + 1} should warn only")
            ViolationLog.objects.filter(
                student_id=self.student.id, exam_id=self.exam.id, violation_type="PROCTOR_FEED_LOST"
            ).update(timestamp=dj_tz.now() - timedelta(minutes=10))
        se.refresh_from_db()
        self.assertEqual(se.status, "Banned")
        self.assertEqual(se.proctor_official_warnings, 4)
