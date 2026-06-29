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
