from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0032_add_testbankquestion_en_fields"),
    ]

    operations = [
        migrations.AddField(
            model_name="direction",
            name="taught_kafedralar",
            field=models.ManyToManyField(
                blank=True,
                db_table="direction_kafedralar",
                related_name="taught_directions",
                to="core.kafedra",
            ),
        ),
    ]
