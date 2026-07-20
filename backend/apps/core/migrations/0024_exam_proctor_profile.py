from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0023_studentexam_ban_reason"),
    ]

    operations = [
        migrations.AddField(
            model_name="exam",
            name="proctor_profile",
            field=models.CharField(blank=True, default="standard", max_length=16),
        ),
    ]
