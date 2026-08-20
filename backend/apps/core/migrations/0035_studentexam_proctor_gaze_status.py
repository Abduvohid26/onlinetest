from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0034_studentexam_proctor_engine_status"),
    ]

    operations = [
        migrations.AddField(
            model_name="studentexam",
            name="proctor_gaze_status",
            field=models.CharField(blank=True, default="", max_length=16),
        ),
    ]
