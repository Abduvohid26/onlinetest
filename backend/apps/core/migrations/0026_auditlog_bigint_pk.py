"""audit_logs.id: integer -> bigint (loyihadagi barcha jadvallar bilan bir xil).

NEGA KERAK: 0018 migratsiyasi jadvalni `AutoField` (integer) bilan yaratgan,
lekin `settings.DEFAULT_AUTO_FIELD` = BigAutoField. Shu nomuvofiqlik tufayli
`makemigrations --check` doim "yetishmayotgan migratsiya" deb yiqilardi va CI
o'tmasdi. Boshqa barcha jadvallarda `id` allaqachon bigint — bu shuni tekislaydi.

DIQQAT (deploy): PostgreSQL ustun turini o'zgartirishda jadvalni qayta yozadi
va ACCESS EXCLUSIVE qulf oladi. `audit_logs` katta bo'lsa migratsiya bir necha
soniya/daqiqa davom etishi mumkin — kam yuklangan vaqtda deploy qilish tavsiya
etiladi. Ma'lumot yo'qolmaydi (integer -> bigint kengaytirish, kesish emas).
"""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0025_direction'),
    ]

    operations = [
        migrations.AlterField(
            model_name='auditlog',
            name='id',
            field=models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID'),
        ),
    ]
