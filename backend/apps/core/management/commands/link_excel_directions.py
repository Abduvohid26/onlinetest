"""Excel (MAVZULAR 14.08.2026) bo'yicha yo'nalish ↔ kafedra bog'lash.

Eski 15 ta Direction (DI, TPI, …) saqlanadi — yangi qator yaratilmaydi.
Har bir yo'nalish o'qitiladigan barcha kafedralarga M2M orqali ulanadi;
`kafedra_id` FK esa asosiy (eng ko'p fanli) kafedraga yoziladi.

  python manage.py link_excel_directions
  python manage.py link_excel_directions --apply
"""
from __future__ import annotations

from django.core.management.base import BaseCommand
from django.db import transaction

from apps.core.excel_direction_map import (
    KAFEDRA_DIRECTIONS,
    PRIMARY_KAFEDRA_BY_DIRECTION,
    norm_kafedra_name,
)
from apps.core.models import Direction, Kafedra


class Command(BaseCommand):
    help = "Excel katalogiga qarab Direction ↔ Kafedra bog'laydi (M2M + primary FK)."

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true", help="Haqiqatan saqlash (default: dry-run)")

    def handle(self, *args, **opts):
        apply_changes = bool(opts["apply"])
        kafedralar = list(Kafedra.objects.all())
        by_norm = {norm_kafedra_name(k.name): k for k in kafedralar}

        missing_kafedra: list[str] = []
        missing_direction: set[str] = set()
        links = 0
        primary_set = 0

        with transaction.atomic():
            for kf_name, codes in KAFEDRA_DIRECTIONS.items():
                kf = by_norm.get(norm_kafedra_name(kf_name))
                if kf is None:
                    missing_kafedra.append(kf_name)
                    self.stdout.write(self.style.WARNING(f"  [KAFEDRA YO'Q] {kf_name}"))
                    continue
                for code in codes:
                    dr = Direction.objects.filter(name__iexact=code).first()
                    if dr is None:
                        missing_direction.add(code)
                        self.stdout.write(self.style.WARNING(f"  [YONALISH YO'Q] {code}  ({kf.name})"))
                        continue
                    links += 1
                    self.stdout.write(f"  {dr.name}  ←  {kf.name}")
                    if apply_changes:
                        dr.taught_kafedralar.add(kf)

            for code, primary_name in PRIMARY_KAFEDRA_BY_DIRECTION.items():
                dr = Direction.objects.filter(name__iexact=code).first()
                kf = by_norm.get(norm_kafedra_name(primary_name))
                if dr is None or kf is None:
                    continue
                primary_set += 1
                self.stdout.write(f"  PRIMARY {dr.name} → {kf.name}")
                if apply_changes:
                    if dr.kafedra_id != kf.id:
                        dr.kafedra = kf
                        dr.save(update_fields=["kafedra_id"])

            if not apply_changes:
                transaction.set_rollback(True)

        self.stdout.write("")
        self.stdout.write(
            f"NATIJA: bog'lanish={links}  primary_fk={primary_set}  "
            f"kafedra_yo'q={len(missing_kafedra)}  yonalish_yo'q={len(missing_direction)}  "
            f"APPLY={apply_changes}"
        )
        if missing_direction:
            self.stdout.write(self.style.WARNING("Topilmagan yo'nalish: " + ", ".join(sorted(missing_direction))))
        if not apply_changes:
            self.stdout.write(self.style.WARNING("Bu DRY-RUN — saqlash uchun --apply qo'shing"))
