from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0014_studentexam_session_challenge"),
    ]

    operations = [
        migrations.AddField(
            model_name="studentexam",
            name="identity_verified_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="studentexam",
            name="device_session_token",
            field=models.CharField(blank=True, default="", max_length=128),
        ),
    ]
