from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0021_technical_retakes"),
    ]

    operations = [
        migrations.AlterField(
            model_name="exam",
            name="technical_retakes_allowed",
            field=models.PositiveSmallIntegerField(default=3),
        ),
        migrations.AddField(
            model_name="exam",
            name="identity_retakes_allowed",
            field=models.PositiveSmallIntegerField(default=1),
        ),
        migrations.AddField(
            model_name="studentexam",
            name="identity_retakes_used",
            field=models.PositiveSmallIntegerField(default=0),
        ),
    ]
