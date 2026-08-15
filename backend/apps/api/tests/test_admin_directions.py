"""Admin: Yo'nalish (Direction) CRUD va Guruh bilan bog'lanishi."""
from __future__ import annotations

import bcrypt
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from apps.core.models import AppUser, Direction, Group, Kafedra, Level

PROFILE = (
    "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlcZ/"
    "2wBDAQwSERMWGR8lJx8lPz09Pz09Pz09Pz09Pz09Pz09Pz09Pz09Pz09Pz09Pz09Pz09Pz09Pz09Pz09Pz09Pz09P//wAARCAABAAEDAREAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGQAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//Z"
)


def _rf_throttle_off():
    from django.conf import settings
    import copy

    rf = copy.deepcopy(settings.REST_FRAMEWORK)
    rf["DEFAULT_THROTTLE_CLASSES"] = []
    rf["DEFAULT_THROTTLE_RATES"] = {k: "100000/h" for k in rf.get("DEFAULT_THROTTLE_RATES", {})}
    return rf


@override_settings(REST_FRAMEWORK=_rf_throttle_off())
class AdminDirectionsTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.level = Level.objects.create(name="Direction-test level")
        hp = bcrypt.hashpw(b"smoke-admin", bcrypt.gensalt(rounds=10)).decode("ascii")
        cls.admin = AppUser.objects.create(
            id="dir_smoke_admin",
            password=hp,
            role="admin",
            name="Dir Smoke Admin",
            group=None,
            profile_image=PROFILE,
            status="Active",
        )

    def setUp(self):
        self.client = APIClient()
        r = self.client.post(
            "/api/auth/login", {"id": "dir_smoke_admin", "password": "smoke-admin"}, format="json"
        )
        self.assertEqual(r.status_code, 200, r.content)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {r.json()['token']}")

    def test_create_list_rename_delete_direction(self):
        r = self.client.post("/api/admin/directions", {"name": "Davolash ishi"}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        direction_id = r.json()["id"]

        r = self.client.get("/api/admin/directions")
        self.assertEqual(r.status_code, 200)
        names = [d["name"] for d in r.json()]
        self.assertIn("Davolash ishi", names)

        r = self.client.patch(
            f"/api/admin/directions/{direction_id}", {"name": "Stomatologiya"}, format="json"
        )
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["name"], "Stomatologiya")

        r = self.client.delete(f"/api/admin/directions/{direction_id}")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertFalse(Direction.objects.filter(pk=direction_id).exists())

    def test_duplicate_direction_name_rejected(self):
        Direction.objects.create(name="Pediatriya")
        r = self.client.post("/api/admin/directions", {"name": "pediatriya"}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_cannot_delete_direction_with_groups(self):
        direction = Direction.objects.create(name="Farmatsiya")
        Group.objects.create(name="Farm-101", level=self.level, direction=direction)
        r = self.client.delete(f"/api/admin/directions/{direction.id}")
        self.assertEqual(r.status_code, 400)
        self.assertTrue(Direction.objects.filter(pk=direction.id).exists())

    def test_group_create_with_direction_and_listing(self):
        direction = Direction.objects.create(name="Jamoat salomatligi")
        r = self.client.post(
            "/api/admin/groups",
            {"name": "JS-101", "level_id": self.level.id, "direction_id": direction.id},
            format="json",
        )
        self.assertEqual(r.status_code, 200, r.content)
        group_id = r.json()["id"]

        r = self.client.get("/api/admin/groups")
        self.assertEqual(r.status_code, 200)
        row = next(g for g in r.json() if g["id"] == group_id)
        self.assertEqual(row["direction_id"], direction.id)
        self.assertEqual(row["direction_name"], "Jamoat salomatligi")

    def test_group_create_without_direction_is_optional(self):
        r = self.client.post(
            "/api/admin/groups", {"name": "NoDir-101", "level_id": self.level.id}, format="json"
        )
        self.assertEqual(r.status_code, 200, r.content)
        group_id = r.json()["id"]
        grp = Group.objects.get(pk=group_id)
        self.assertIsNone(grp.direction_id)

    def test_group_patch_direction_id(self):
        d1 = Direction.objects.create(name="Davolash ishi 2")
        d2 = Direction.objects.create(name="Stomatologiya 2")
        grp = Group.objects.create(name="Patch-101", level=self.level, direction=d1)
        r = self.client.patch(
            f"/api/admin/groups/{grp.id}", {"direction_id": d2.id}, format="json"
        )
        self.assertEqual(r.status_code, 200, r.content)
        grp.refresh_from_db()
        self.assertEqual(grp.direction_id, d2.id)

        # bo'shatish (direction'siz qoldirish) ham ishlashi kerak
        r = self.client.patch(f"/api/admin/groups/{grp.id}", {"direction_id": None}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        grp.refresh_from_db()
        self.assertIsNone(grp.direction_id)

    def test_group_create_rejects_invalid_direction_id(self):
        r = self.client.post(
            "/api/admin/groups",
            {"name": "Bad-101", "level_id": self.level.id, "direction_id": 999999},
            format="json",
        )
        self.assertEqual(r.status_code, 400)

    def test_deleting_direction_sets_group_direction_null(self):
        """SET_NULL: yo'nalish o'chirilsa (guruhsiz holatda) — bu yerda guruh
        boshqa yo'nalishga ega bo'lgani uchun o'chirish 400 bilan bloklanadi,
        lekin agar guruh manba yo'nalishdan ozod qilinsa (patch bilan) keyin
        yo'nalish muvaffaqiyatli o'chadi va boshqa guruhlarga ta'sir qilmaydi."""
        direction = Direction.objects.create(name="Vaqtinchalik yo'nalish")
        grp = Group.objects.create(name="Temp-101", level=self.level, direction=direction)
        self.client.patch(f"/api/admin/groups/{grp.id}", {"direction_id": None}, format="json")
        r = self.client.delete(f"/api/admin/directions/{direction.id}")
        self.assertEqual(r.status_code, 200, r.content)
        grp.refresh_from_db()
        self.assertIsNone(grp.direction_id)

    def test_create_direction_with_kafedra_ids(self):
        k1 = Kafedra.objects.create(name="Kafedra A")
        k2 = Kafedra.objects.create(name="Kafedra B")
        r = self.client.post(
            "/api/admin/directions",
            {"name": "DI", "kafedra_ids": [k1.id, k2.id]},
            format="json",
        )
        self.assertEqual(r.status_code, 200, r.content)
        body = r.json()
        self.assertEqual(sorted(body["kafedra_ids"]), sorted([k1.id, k2.id]))
        self.assertEqual(body["kafedra_id"], k1.id)
        dr = Direction.objects.get(pk=body["id"])
        self.assertEqual(set(dr.taught_kafedralar.values_list("id", flat=True)), {k1.id, k2.id})
        self.assertEqual(dr.kafedra_id, k1.id)

    def test_patch_kafedra_ids_updates_m2m_and_primary(self):
        k1 = Kafedra.objects.create(name="Kafedra C")
        k2 = Kafedra.objects.create(name="Kafedra D")
        dr = Direction.objects.create(name="TPI", kafedra=k1)
        dr.taught_kafedralar.set([k1])
        r = self.client.patch(
            f"/api/admin/directions/{dr.id}",
            {"kafedra_ids": [k2.id, k1.id]},
            format="json",
        )
        self.assertEqual(r.status_code, 200, r.content)
        body = r.json()
        self.assertEqual(sorted(body["kafedra_ids"]), sorted([k2.id, k1.id]))
        self.assertEqual(body["kafedra_id"], k2.id)
        dr.refresh_from_db()
        self.assertEqual(dr.kafedra_id, k2.id)

    def test_legacy_kafedra_id_still_works(self):
        kf = Kafedra.objects.create(name="Kafedra E")
        r = self.client.post(
            "/api/admin/directions",
            {"name": "OHI", "kafedra_id": kf.id},
            format="json",
        )
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["kafedra_ids"], [kf.id])
