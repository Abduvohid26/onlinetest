from django.db import models


class Level(models.Model):
    """Kurs/daraja (masalan "1-kurs", "2-kurs")."""

    name = models.CharField(max_length=200, unique=True)

    class Meta:
        app_label = "core"
        db_table = "levels"


class Kafedra(models.Model):
    """Kafedra (masalan "Ichki kasalliklar kafedrasi") — Direction'ning tashkiliy ota-bo'g'ini."""

    name = models.CharField(max_length=200, unique=True)
    code = models.CharField(max_length=50, unique=True, null=True, blank=True)
    sort_order = models.PositiveSmallIntegerField(default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        app_label = "core"
        db_table = "kafedralar"
        ordering = ["sort_order", "name"]

    def __str__(self) -> str:
        return self.name


class Direction(models.Model):
    """Yo'nalish/fakultet (masalan "Davolash ishi", "Stomatologiya").

    Kurs (Level) bilan mustaqil o'q: guruh ikkalasiga ham bog'lanadi
    (masalan "1-kurs / Davolash ishi / 101-guruh").
    """

    name = models.CharField(max_length=200, unique=True)
    # NULL = kafedra hali belgilanmagan (mavjud yo'nalishlar shu holatda import
    # qilingan) — admin panel orqali keyin to'ldiriladi, majburiy emas.
    kafedra = models.ForeignKey(
        Kafedra, null=True, blank=True, on_delete=models.SET_NULL,
        db_column="kafedra_id", related_name="directions",
    )

    class Meta:
        app_label = "core"
        db_table = "directions"


class Group(models.Model):
    name = models.CharField(max_length=200)
    level = models.ForeignKey(Level, on_delete=models.CASCADE, db_column="level_id")
    # NULL = eski guruhlar (yo'nalish qo'shilishidan oldin yaratilgan) — majburiy emas.
    direction = models.ForeignKey(
        Direction, null=True, blank=True, on_delete=models.SET_NULL, db_column="direction_id"
    )
    program_track = models.CharField(max_length=20, default="bachelor")
    academic_year = models.PositiveSmallIntegerField(null=True, blank=True)
    # Guruh qabul qilingan o'quv yili (masalan 2025) — yillik kurs ko'tarilishini
    # (current_level = shu_yil - intake_year + 1) hisoblash uchun. NULL = eski
    # guruhlar (bu maydon qo'shilishidan oldin yaratilgan), qo'lda to'ldiriladi.
    intake_year = models.PositiveSmallIntegerField(null=True, blank=True)
    # False = guruh bitirgan (yoki boshqa sababga ko'ra arxivlangan) — `promote_groups`
    # yillik kurs ko'tarishda hisoblangan kurs raqami maksimal kursdan oshib ketsa, shu
    # bayroq o'chiriladi va `level` ga endi tegilmaydi. Talabalar/tarix saqlanib qoladi.
    is_active = models.BooleanField(default=True)

    class Meta:
        app_label = "core"
        db_table = "groups"


class AppUser(models.Model):
    id = models.CharField(max_length=64, primary_key=True)
    password = models.CharField(max_length=128)
    role = models.CharField(max_length=20)
    name = models.CharField(max_length=200)
    status = models.CharField(max_length=20, default="Active")
    group = models.ForeignKey(
        Group, null=True, blank=True, on_delete=models.SET_NULL, db_column="group_id"
    )
    profile_image = models.TextField(blank=True)

    class Meta:
        app_label = "core"
        db_table = "users"


class AuditLog(models.Model):
    actor_id = models.CharField(max_length=64)
    actor_name = models.CharField(max_length=200, blank=True)
    action = models.CharField(max_length=64)
    target_type = models.CharField(max_length=40, blank=True)
    target_id = models.CharField(max_length=128, blank=True)
    target_name = models.CharField(max_length=200, blank=True)
    detail = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        app_label = "core"
        db_table = "audit_logs"
        ordering = ["-created_at"]
        # Indeks nomlari ATAYLAB aniq yozilgan: 0018 migratsiyasi ularni shu
        # nomlar bilan yaratgan. `name=` ko'rsatilmasa Django xesh asosidagi
        # boshqa nom kutadi va har `makemigrations --check` da ortiqcha
        # RenameIndex chiqib, CI yiqilardi.
        indexes = [
            models.Index(fields=["-created_at"], name="audit_logs_created_idx"),
            models.Index(fields=["actor_id"], name="audit_logs_actor_idx"),
        ]
