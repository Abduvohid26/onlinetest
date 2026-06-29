from django.db import models


class TestBankCategory(models.Model):
    name = models.CharField(max_length=300)
    description = models.TextField(blank=True)
    sort_order = models.IntegerField(default=0)
    program_track = models.CharField(max_length=20, default="any")
    academic_year = models.PositiveSmallIntegerField(null=True, blank=True)
    source_language = models.CharField(max_length=10, default="en")

    class Meta:
        app_label = "core"
        db_table = "test_bank_categories"


class TestBankQuestion(models.Model):
    category = models.ForeignKey(
        TestBankCategory, on_delete=models.CASCADE, db_column="category_id"
    )
    text = models.TextField()
    options_json = models.TextField()
    correct_answer = models.CharField(max_length=500)
    language = models.CharField(max_length=10, default="en")
    created_at = models.DateTimeField(auto_now_add=True)
    text_uz = models.TextField(blank=True)
    text_ru = models.TextField(blank=True)
    options_uz_json = models.TextField(blank=True, default="[]")
    options_ru_json = models.TextField(blank=True, default="[]")
    correct_answer_uz = models.CharField(max_length=500, blank=True)
    correct_answer_ru = models.CharField(max_length=500, blank=True)

    class Meta:
        app_label = "core"
        db_table = "test_bank_questions"


class ResultIdCounter(models.Model):
    """Yagona qator: id=1 (migratsiyada insert)."""

    id = models.IntegerField(primary_key=True)
    next_num = models.IntegerField(default=37923423)

    class Meta:
        app_label = "core"
        db_table = "result_id_sequence"
