from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0031_add_exam_direction'),
    ]

    operations = [
        migrations.AddField(
            model_name='testbankquestion',
            name='text_en',
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name='testbankquestion',
            name='options_en_json',
            field=models.TextField(blank=True, default='[]'),
        ),
        migrations.AddField(
            model_name='testbankquestion',
            name='correct_answer_en',
            field=models.CharField(blank=True, max_length=500),
        ),
    ]
