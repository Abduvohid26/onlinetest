from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0019_studentexam_identity_last_match"),
    ]

    operations = [
        migrations.AddField(
            model_name="exam",
            name="imentor_subject_codes",
            field=models.TextField(blank=True, default="[]"),
        ),
    ]
