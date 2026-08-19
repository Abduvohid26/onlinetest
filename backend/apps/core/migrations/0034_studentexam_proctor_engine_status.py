from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0033_direction_taught_kafedralar"),
    ]

    operations = [
        migrations.AddField(
            model_name="studentexam",
            name="proctor_engine_status",
            field=models.CharField(blank=True, default="", max_length=16),
        ),
        migrations.AddField(
            model_name="studentexam",
            name="proctor_engine_reported_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
