"""Eski imtihon sessiyalariga iMentor `references` (manba) ni qayta biriktiradi.

iMentor da `backfill_test_sources --apply` qilingach API da manba paydo bo'ladi,
lekin OnlineTest da OLDIN yaratilgan `session_questions_json` da references yo'q
bo'lib qoladi. Shu buyruq matn bo'yicha moslab manbani yozadi va ai_summary ni
yangilaydi — natija sahifasida "Manbalar" chiqadi.

  python manage.py backfill_imentor_references
  python manage.py backfill_imentor_references --apply
  python manage.py backfill_imentor_references --test-ids 24 --apply
  python manage.py backfill_imentor_references --subject urologiya-va-onkologiya --apply
"""
from __future__ import annotations

import json

from django.core.management.base import BaseCommand
from django.db import transaction

from apps.api.imentor_client import imentor_configured
from apps.api.imentor_service import (
    build_imentor_reference_index,
    enrich_questions_with_imentor_references,
    sync_ai_summary_item_references,
)
from apps.api.view_utils import safe_json_loads
from apps.core.models import Exam, StudentExam


class Command(BaseCommand):
    help = "Saqlangan imtihon savollariga iMentor manbalarini (references) biriktiradi."

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true", help="Haqiqatan saqlash")
        parser.add_argument(
            "--test-ids",
            default="",
            help="iMentor test id lari: 24 yoki 24,25",
        )
        parser.add_argument("--subject", default="", help="Faqat shu subject_code indeksi")
        parser.add_argument("--limit", type=int, default=0, help="Nechta StudentExam (0=hammasi)")

    def handle(self, *args, **opts):
        apply_changes = bool(opts["apply"])
        if not imentor_configured():
            self.stderr.write(self.style.ERROR("IMENTOR_API_KEY sozlanmagan"))
            return

        test_ids = [
            int(x)
            for x in str(opts["test_ids"] or "").replace(" ", "").split(",")
            if x.isdigit()
        ]
        subject = str(opts["subject"] or "").strip() or None

        self.stdout.write("iMentor reference index yuklanmoqda…")
        index = build_imentor_reference_index(
            test_ids=test_ids or None,
            subject_code=subject,
        )
        self.stdout.write(f"  indekslangan savol matnlari: {len(index)}")
        if not index:
            self.stderr.write(self.style.ERROR("Manbali savol topilmadi — iMentor backfill qilinganmi?"))
            return

        exam_patched = 0
        exam_q_patched = 0
        for exam in Exam.objects.filter(exam_mode="imentor_mixed").iterator():
            qs = safe_json_loads(exam.questions_json, [])
            if not isinstance(qs, list) or not qs:
                continue
            new_qs, n = enrich_questions_with_imentor_references(qs, index=index)
            if n <= 0:
                continue
            exam_patched += 1
            exam_q_patched += n
            self.stdout.write(f"  Exam#{exam.id}: {n} savol")
            if apply_changes:
                exam.questions_json = json.dumps(new_qs, ensure_ascii=False)
                exam.save(update_fields=["questions_json"])

        se_qs = StudentExam.objects.exclude(session_questions_json__isnull=True).exclude(
            session_questions_json=""
        )
        if opts["limit"]:
            se_qs = se_qs.order_by("-id")[: int(opts["limit"])]

        se_patched = 0
        se_q_patched = 0
        for se in se_qs.iterator():
            qs = safe_json_loads(se.session_questions_json, [])
            if not isinstance(qs, list) or not qs:
                continue
            new_qs, n = enrich_questions_with_imentor_references(qs, index=index)
            if n <= 0:
                continue
            se_patched += 1
            se_q_patched += n
            self.stdout.write(f"  StudentExam#{se.id} exam={se.exam_id}: {n} savol")
            if apply_changes:
                with transaction.atomic():
                    se.session_questions_json = json.dumps(new_qs, ensure_ascii=False)
                    fields = ["session_questions_json"]
                    if se.ai_summary_json:
                        ai = safe_json_loads(se.ai_summary_json, {})
                        se.ai_summary_json = json.dumps(
                            sync_ai_summary_item_references(ai, new_qs),
                            ensure_ascii=False,
                        )
                        fields.append("ai_summary_json")
                    se.save(update_fields=fields)

        self.stdout.write("")
        self.stdout.write(
            f"NATIJA: exam={exam_patched} ({exam_q_patched} savol), "
            f"student_exam={se_patched} ({se_q_patched} savol)  APPLY={apply_changes}"
        )
        if not apply_changes:
            self.stdout.write(self.style.WARNING("Bu DRY-RUN — saqlash uchun --apply qo'shing"))
