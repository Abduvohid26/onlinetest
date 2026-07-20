from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0020_exam_imentor_subject_codes"),
    ]

    operations = [
        migrations.AddField(
            model_name="exam",
            name="technical_retakes_allowed",
            field=models.PositiveSmallIntegerField(default=5),
        ),
        migrations.AddField(
            model_name="studentexam",
            name="technical_retakes_used",
            field=models.PositiveSmallIntegerField(default=0),
        ),
        migrations.AddField(
            model_name="studentexam",
            name="bonus_technical_retakes",
            field=models.PositiveSmallIntegerField(default=0),
        ),
    ]
