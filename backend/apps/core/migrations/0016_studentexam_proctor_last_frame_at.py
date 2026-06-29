from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0015_studentexam_security_fields"),
    ]

    operations = [
        migrations.AddField(
            model_name="studentexam",
            name="proctor_last_frame_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
