"""Guruhlarni `intake_year` asosida yillik kursga ko'taradi (1-sentyabr chegarasi bilan).

Guruh nomi va tarkibi o'zgarmaydi — faqat `Group.level` FK joriy o'quv yiliga qarab
qayta hisoblanadi: current_level = joriy_o'quv_yili_boshi - intake_year + 1.
Joriy o'quv yili boshi: 1-sentyabrgacha o'tgan yil, 1-sentyabrdan keyin joriy yil.

Hisoblangan kurs guruhning maksimal kursidan katta bo'lsa, guruh bitirgan deb
hisoblanadi — `is_active=False`, `level`ga tegilmaydi.

  python manage.py promote_groups                              # dry-run, hammasi
  python manage.py promote_groups --apply                      # haqiqatan yozadi
  python manage.py promote_groups --as-of-date 2026-09-01       # sana simulyatsiyasi
  python manage.py promote_groups --default-max-level 6 --apply
  python manage.py promote_groups --max-level-overrides "S:5,F:5,TPI:5" --apply
"""
from __future__ import annotations

import datetime
import re

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.core.models import AuditLog, Group, Level


def academic_year_start(as_of: datetime.date) -> int:
    """1-sentyabrgacha — o'tgan yil boshlangan; 1-sentyabrdan keyin — joriy yil."""
    return as_of.year if as_of.month >= 9 else as_of.year - 1


def parse_max_level_overrides(raw: str) -> dict[str, int]:
    out: dict[str, int] = {}
    for part in (raw or "").split(","):
        part = part.strip()
        if not part or ":" not in part:
            continue
        key, _, val = part.partition(":")
        key = key.strip().upper()
        try:
            out[key] = int(val.strip())
        except ValueError:
            continue
    return out


def level_number_from_name(name: str) -> int | None:
    m = re.match(r"\s*(\d+)", name or "")
    return int(m.group(1)) if m else None


class Command(BaseCommand):
    help = "Guruhlarni intake_year asosida yillik kursga ko'taradi (1-sentyabr chegarasi)."

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true", help="Haqiqatan saqlash (default: dry-run)")
        parser.add_argument(
            "--as-of-date",
            default="",
            help="YYYY-MM-DD — shu sanaga nisbatan hisoblash (default: bugun)",
        )
        parser.add_argument(
            "--default-max-level",
            type=int,
            default=6,
            help="Yo'nalish uchun override bo'lmasa ishlatiladigan maksimal kurs (default: 6)",
        )
        parser.add_argument(
            "--max-level-overrides",
            default="",
            help='Yo\'nalish kodi bo\'yicha maksimal kurs, masalan "S:5,F:5,TPI:5"',
        )
        parser.add_argument(
            "--include-inactive",
            action="store_true",
            help="is_active=False guruhlarni ham qayta ko'rib chiqish (default: faqat faol)",
        )

    def handle(self, *args, **opts):
        apply_changes = bool(opts["apply"])

        if opts["as_of_date"]:
            try:
                as_of = datetime.date.fromisoformat(opts["as_of_date"])
            except ValueError:
                raise CommandError("--as-of-date formati YYYY-MM-DD bo'lishi kerak")
        else:
            as_of = datetime.date.today()

        ay_start = academic_year_start(as_of)
        default_max = int(opts["default_max_level"])
        overrides = parse_max_level_overrides(opts["max_level_overrides"])

        self.stdout.write(
            f"Sana: {as_of.isoformat()}  Joriy o'quv yili boshlangan: {ay_start}  "
            f"Default max kurs: {default_max}  Overrides: {overrides or '—'}"
        )

        qs = Group.objects.select_related("level", "direction")
        if not opts["include_inactive"]:
            qs = qs.filter(is_active=True)

        promoted = 0
        graduated = 0
        unchanged = 0
        skipped_no_intake = 0
        skipped_invalid = 0

        with transaction.atomic():
            for g in qs.iterator():
                if g.intake_year is None:
                    skipped_no_intake += 1
                    continue

                target_number = ay_start - g.intake_year + 1
                if target_number < 1:
                    self.stdout.write(
                        self.style.WARNING(
                            f"  [SKIP] {g.name} (id={g.id}): intake_year={g.intake_year} "
                            f"kelajakda — hisoblangan kurs {target_number} < 1"
                        )
                    )
                    skipped_invalid += 1
                    continue

                direction_code = (g.direction.name if g.direction_id else "").strip().upper()
                max_level = overrides.get(direction_code, default_max)

                if target_number > max_level:
                    if g.is_active:
                        self.stdout.write(
                            f"  [BITIRDI] {g.name} (id={g.id}): kurs {target_number} > max {max_level} "
                            f"— is_active=False"
                        )
                        graduated += 1
                        if apply_changes:
                            g.is_active = False
                            g.save(update_fields=["is_active"])
                            AuditLog.objects.create(
                                actor_id="system",
                                actor_name="promote_groups",
                                action="graduate_group",
                                target_type="group",
                                target_id=str(g.id),
                                target_name=g.name,
                                detail=f"target_level={target_number}, max_level={max_level}",
                            )
                    else:
                        unchanged += 1
                    continue

                target_name = f"{target_number}-kurs"
                current_number = level_number_from_name(g.level.name) if g.level_id else None
                if current_number == target_number:
                    unchanged += 1
                    continue

                self.stdout.write(
                    f"  [KO'TARISH] {g.name} (id={g.id}): "
                    f"{g.level.name if g.level_id else '—'} → {target_name}"
                )
                promoted += 1
                if apply_changes:
                    level_obj, _ = Level.objects.get_or_create(name=target_name)
                    old_level_name = g.level.name if g.level_id else "—"
                    g.level = level_obj
                    g.save(update_fields=["level"])
                    AuditLog.objects.create(
                        actor_id="system",
                        actor_name="promote_groups",
                        action="promote_group",
                        target_type="group",
                        target_id=str(g.id),
                        target_name=g.name,
                        detail=f"{old_level_name!r} → {target_name!r}",
                    )

            if not apply_changes:
                transaction.set_rollback(True)

        self.stdout.write("")
        self.stdout.write(
            f"NATIJA: ko'tarildi={promoted}  bitirdi={graduated}  o'zgarishsiz={unchanged}  "
            f"intake_year yo'q (o'tkazib yuborildi)={skipped_no_intake}  "
            f"noto'g'ri intake_year={skipped_invalid}  APPLY={apply_changes}"
        )
        if not apply_changes:
            self.stdout.write(self.style.WARNING("Bu DRY-RUN — saqlash uchun --apply qo'shing"))
