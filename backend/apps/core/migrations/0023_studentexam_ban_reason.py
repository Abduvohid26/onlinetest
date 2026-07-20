from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0022_exam_retake_policy"),
    ]

    operations = [
        migrations.AddField(
            model_name="studentexam",
            name="ban_reason",
            field=models.CharField(blank=True, default="", max_length=32),
        ),
    ]
