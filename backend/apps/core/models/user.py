from django.db import models


class Level(models.Model):
    name = models.CharField(max_length=200, unique=True)

    class Meta:
        app_label = "core"
        db_table = "levels"


class Group(models.Model):
    name = models.CharField(max_length=200)
    level = models.ForeignKey(Level, on_delete=models.CASCADE, db_column="level_id")
    program_track = models.CharField(max_length=20, default="bachelor")
    academic_year = models.PositiveSmallIntegerField(null=True, blank=True)

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
        indexes = [
            models.Index(fields=["-created_at"]),
            models.Index(fields=["actor_id"]),
        ]
