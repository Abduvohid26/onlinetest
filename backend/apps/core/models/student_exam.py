from django.db import models

from .exam import Exam
from .user import AppUser


class StudentExam(models.Model):
    student = models.ForeignKey(
        AppUser, on_delete=models.CASCADE, db_column="student_id", to_field="id"
    )
    exam = models.ForeignKey(Exam, on_delete=models.CASCADE, db_column="exam_id")
    status = models.CharField(max_length=20, default="Pending")
    score = models.IntegerField(null=True, blank=True)
    answers_json = models.TextField(blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    flagged_questions_json = models.TextField(default="[]")
    session_questions_json = models.TextField(blank=True, null=True)
    draft_answers_json = models.TextField(default="{}")
    draft_flagged_json = models.TextField(default="[]")
    draft_updated_at = models.DateTimeField(null=True, blank=True)
    result_public_id = models.CharField(max_length=100, blank=True, null=True, unique=True)
    result_verify_secret = models.CharField(max_length=128, blank=True, null=True)
    ai_summary_json = models.TextField(blank=True, null=True)
    device_fingerprint = models.CharField(max_length=128, blank=True, default="")
    device_bound_at = models.DateTimeField(null=True, blank=True)
    session_signing_key = models.CharField(max_length=128, blank=True, default="")
    session_request_seq = models.PositiveIntegerField(default=1)
    session_challenge = models.CharField(max_length=64, blank=True, default="")
    device_session_token = models.CharField(max_length=128, blank=True, default="")
    identity_verified_at = models.DateTimeField(null=True, blank=True)
    identity_last_checked_at = models.DateTimeField(null=True, blank=True)
    identity_last_matched = models.BooleanField(null=True, blank=True, default=None)
    identity_last_score = models.FloatField(null=True, blank=True)
    identity_last_method = models.CharField(max_length=20, blank=True, default="")
    identity_last_code = models.CharField(max_length=40, blank=True, default="")
    proctor_official_warnings = models.PositiveSmallIntegerField(default=0)
    proctor_last_warning_at = models.DateTimeField(null=True, blank=True)
    proctor_last_frame_at = models.DateTimeField(null=True, blank=True)
    #: Brauzerdagi real-time proctoring engine (MediaPipe) holati: "" (hali
    #: xabar yo'q) | "ok" | "unavailable". Engine model yuklay olmasa nazoratning
    #: bir qismi (gaze/pozitsiya/qo'l/ob'ekt) jimgina o'chib qolardi va buni hech
    #: kim bilmasdi — endi klient bu holatni xabar qiladi, admin ko'ra oladi.
    proctor_engine_status = models.CharField(max_length=16, blank=True, default="")
    proctor_engine_reported_at = models.DateTimeField(null=True, blank=True)
    technical_retakes_used = models.PositiveSmallIntegerField(default=0)
    bonus_technical_retakes = models.PositiveSmallIntegerField(default=0)
    identity_retakes_used = models.PositiveSmallIntegerField(default=0)
    ban_reason = models.CharField(max_length=32, blank=True, default="")

    class Meta:
        app_label = "core"
        db_table = "student_exams"
        indexes = [
            models.Index(fields=["student", "exam"]),
        ]
