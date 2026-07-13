from django.db import models

from .user import AppUser, Group


class Exam(models.Model):
    teacher = models.ForeignKey(
        AppUser, on_delete=models.CASCADE, db_column="teacher_id", to_field="id"
    )
    title = models.CharField(max_length=500)
    start_time = models.DateTimeField()
    end_time = models.DateTimeField()
    duration_minutes = models.IntegerField()
    questions_json = models.TextField(default="[]")
    language = models.CharField(max_length=10, default="uz")
    pin = models.CharField(max_length=50, blank=True)
    custom_rules = models.TextField(blank=True)
    exam_mode = models.CharField(max_length=20, default="static")
    bank_category_ids = models.TextField(default="[]")
    bank_question_count = models.IntegerField(default=0)
    imentor_subject_codes = models.TextField(default="[]", blank=True)

    class Meta:
        app_label = "core"
        db_table = "exams"


class ExamGroup(models.Model):
    exam = models.ForeignKey(Exam, on_delete=models.CASCADE, db_column="exam_id")
    group = models.ForeignKey(Group, on_delete=models.CASCADE, db_column="group_id")

    class Meta:
        app_label = "core"
        db_table = "exam_groups"
        unique_together = [("exam", "group")]


class ExamStudentException(models.Model):
    """Tanlangan talaba ushbu imtihonni boshlay olmaydi (sabab ko'rsatiladi)."""

    exam = models.ForeignKey(Exam, on_delete=models.CASCADE, db_column="exam_id")
    student = models.ForeignKey(
        AppUser, on_delete=models.CASCADE, db_column="student_id", to_field="id"
    )
    reason = models.TextField()

    class Meta:
        app_label = "core"
        db_table = "exam_student_exceptions"
        unique_together = [("exam", "student")]


class ExamRetakeWindow(models.Model):
    """Imtihon yopilgandan keyin ma'lum talaba uchun qayta kirish vaqti."""

    exam = models.ForeignKey(Exam, on_delete=models.CASCADE, db_column="exam_id")
    student = models.ForeignKey(
        AppUser, on_delete=models.CASCADE, db_column="student_id", to_field="id"
    )
    window_start = models.DateTimeField()
    window_end = models.DateTimeField()
    note = models.TextField(blank=True)

    class Meta:
        app_label = "core"
        db_table = "exam_retake_windows"
        indexes = [
            models.Index(fields=["exam", "student"]),
        ]
