"""Boshlang'ich Kafedra ro'yxatini bir martada yaratadi.

Ro'yxat manbai: `data/talablar kotingenti/*.xlsx` fayllardagi ordinatura/
magistratura guruh nomlaridan chiqarilgan haqiqiy mutaxassislik nomlari
(imlo xatolari va yil/til variantlari tozalangan, dublikatlar birlashtirilgan).

Idempotent — qayta ishga tushirilsa, mavjud nomlarni qayta yaratmaydi
(`get_or_create`).

  python manage.py seed_kafedralar             # dry-run
  python manage.py seed_kafedralar --apply      # haqiqatan yozadi
"""
from __future__ import annotations

from django.core.management.base import BaseCommand

from apps.core.models import Kafedra

KAFEDRA_NAMES = [
    "Akusherlik va ginekologiya",
    "Allergologiya va klinik immunologiya",
    "Anesteziologiya va reanimatologiya",
    "Bolalar allergologiyasi va immunologiyasi",
    "Bolalar anesteziologiya va reanimatologiyasi",
    "Bolalar kardiologiyasi va revmatologiyasi",
    "Bolalar nefrologiyasi gemodializ bilan",
    "Bolalar nevrologiyasi",
    "Bolalar va o'smir qizlar ginekologiyasi",
    "Bolalar xirurgiyasi",
    "Dermatovenerologiya",
    "Endokrinologiya",
    "Epidemiologiya",
    "Ftiziatriya",
    "Gigiyena",
    "Kardiologiya",
    "Kommunal gigiyena",
    "Laboratoriya ishi",
    "Mehnat gigiyenasi",
    "Morfologiya",
    "Narkologiya",
    "Nefrologiya gemodializ bilan",
    "Neonatologiya",
    "Nevrologiya",
    "Nevroxirurgiya",
    "Oftalmologiya",
    "Otorinolaringologiya",
    "Patologik anatomiya",
    "Pediatriya",
    "Psixiatriya",
    "Pulmonologiya",
    "Reabilitologiya",
    "Rentgen",
    "Revmatologiya",
    "Sog'liqni saqlash",
    "Terapevtik stomatologiya",
    "Terapiya",
    "Tibbiy biologik",
    "Tibbiy radiologiya",
    "Travmatologiya va ortopediya",
    "Umumiy onkologiya",
    "Umumiy xirurgiya",
    "Urologiya",
    "Xirurgiya",
    "Yuqumli kasalliklar",
    "Yuz-jag' jarroxligi",
]


class Command(BaseCommand):
    help = "Boshlang'ich Kafedra ro'yxatini (46 ta) bir martada yaratadi."

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true", help="Haqiqatan saqlash (default: dry-run)")

    def handle(self, *args, **opts):
        apply_changes = bool(opts["apply"])
        created = 0
        existing = 0
        for name in KAFEDRA_NAMES:
            already = Kafedra.objects.filter(name__iexact=name).exists()
            if already:
                existing += 1
                continue
            created += 1
            self.stdout.write(f"  [YANGI] {name}")
            if apply_changes:
                Kafedra.objects.get_or_create(name=name)

        self.stdout.write("")
        self.stdout.write(
            f"NATIJA: yangi={created}  mavjud={existing}  jami={len(KAFEDRA_NAMES)}  APPLY={apply_changes}"
        )
        if not apply_changes:
            self.stdout.write(self.style.WARNING("Bu DRY-RUN — saqlash uchun --apply qo'shing"))
