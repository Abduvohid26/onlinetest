import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0024_exam_proctor_profile"),
    ]

    operations = [
        migrations.CreateModel(
            name="Direction",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=200, unique=True)),
            ],
            options={
                "db_table": "directions",
            },
        ),
        migrations.AddField(
            model_name="group",
            name="direction",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                to="core.direction",
                db_column="direction_id",
            ),
        ),
    ]
