from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0017_ban_appeal_index_sync'),
    ]

    operations = [
        migrations.CreateModel(
            name='AuditLog',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('actor_id', models.CharField(max_length=64)),
                ('actor_name', models.CharField(blank=True, max_length=200)),
                ('action', models.CharField(max_length=64)),
                ('target_type', models.CharField(blank=True, max_length=40)),
                ('target_id', models.CharField(blank=True, max_length=128)),
                ('target_name', models.CharField(blank=True, max_length=200)),
                ('detail', models.TextField(blank=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
            ],
            options={
                'db_table': 'audit_logs',
                'ordering': ['-created_at'],
                'app_label': 'core',
            },
        ),
        migrations.AddIndex(
            model_name='auditlog',
            index=models.Index(fields=['-created_at'], name='audit_logs_created_idx'),
        ),
        migrations.AddIndex(
            model_name='auditlog',
            index=models.Index(fields=['actor_id'], name='audit_logs_actor_idx'),
        ),
    ]
