"""Excel xaritasi bo'yicha Direction ↔ Kafedra bog'lash buyrug'i."""
from __future__ import annotations

from django.core.management import call_command
from django.test import TestCase

from apps.core.models import Direction, Kafedra


class LinkExcelDirectionsTests(TestCase):
    def test_apply_links_m2m_and_primary_fk(self):
        di = Direction.objects.create(name="DI")
        tpi = Direction.objects.create(name="TPI")
        kf_pat = Kafedra.objects.create(
            name="Patologik fiziologiya va patologik anatomiya",
        )
        kf_ovq = Kafedra.objects.create(
            name="Ovqatlanish, Bolalar va o 'smirlar gigienasi",
        )
        kf_kom = Kafedra.objects.create(name="Kommunal gigiyena")

        call_command("link_excel_directions", "--apply")

        di.refresh_from_db()
        tpi.refresh_from_db()
        self.assertEqual(di.kafedra_id, kf_pat.id)
        self.assertEqual(tpi.kafedra_id, kf_ovq.id)
        self.assertEqual(
            set(di.taught_kafedralar.values_list("id", flat=True)),
            {kf_pat.id, kf_kom.id},
        )
        self.assertEqual(
            set(tpi.taught_kafedralar.values_list("id", flat=True)),
            {kf_ovq.id, kf_kom.id, kf_pat.id},
        )

    def test_dry_run_does_not_save(self):
        di = Direction.objects.create(name="DI")
        Kafedra.objects.create(name="Kommunal gigiyena")
        call_command("link_excel_directions")
        di.refresh_from_db()
        self.assertIsNone(di.kafedra_id)
        self.assertEqual(di.taught_kafedralar.count(), 0)

    def test_case_insensitive_kafedra_name(self):
        di = Direction.objects.create(name="di")
        kf = Kafedra.objects.create(name="ijtimoiy fanlar")
        call_command("link_excel_directions", "--apply")
        di.refresh_from_db()
        self.assertIn(kf.id, set(di.taught_kafedralar.values_list("id", flat=True)))
