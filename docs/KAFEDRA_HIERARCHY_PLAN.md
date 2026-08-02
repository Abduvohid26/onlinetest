# Kafedra → Yo'nalish → Guruh → Talaba ierarxiyasi — to'liq reja

**Loyihalar:** `onlinetest/OnlineTest` (manba/source of truth) va `imentor` (iste'molchi/consumer)
**Sana:** 2026-08-02
**Tanlangan variant:** A — OnlineTest yagona akademik manba (source of truth), iMentor faqat API orqali o'qiydi.

---

## 1. Muammo

Hozir tashkiliy ierarxiya ikkita bazaga bo'lingan va bir-biriga bog'lanmagan:

- **OnlineTest** (`backend/apps/core/models/user.py`): real, FK bilan bog'langan model bor —
  `Direction` (yo'nalish/fakultet) va `Level` (kurs) → `Group` → `AppUser` (talaba).
  Lekin **Kafedra (Department) modeli umuman yo'q**.
- **iMentor** (`backend/core/models.py`): `AcademicDepartment` (kafedra) bor, lekin u faqat
  fan-syllabus katalogini guruhlash uchun ishlatiladi (tashkiliy tuzilma emas). `StaffProfile` va
  `ClinicalGroupMember`da `faculty`, `department`, `direction`, `study_group` maydonlari bor —
  ammo bularning barchasi **oddiy erkin matn (CharField)**, hech qanday FK yo'q. Guruh, Yo'nalish,
  Student uchun iMentorda alohida model yo'q.

Ikkala tizim faqat HTTP orqali gaplashadi (`onlinetest → imentor`: `apps/api/imentor_client.py`,
savol bazasi uchun; `imentor → onlinetest`: `backend/core/online_test_client.py`, faqat talaba
login uchun). Kafedra/Yo'nalish/Guruh katalogini almashish uchun hech qanday endpoint yo'q.

## 2. Nima uchun variant A (OnlineTest — yagona manba)

- `Direction`, `Group`, `AppUser` allaqachon OnlineTestda FK bilan to'g'ri bog'langan — faqat
  `Kafedra` modelini qo'shib, `Direction.kafedra` FK qilish kifoya.
- Talaba autentifikatsiyasi allaqachon OnlineTestdan keladi (`ONLINE_TEST_API_BASE_URL` orqali) —
  demak talaba bilan bog'liq har qanday tashkiliy ma'lumot ham shu yerdan kelishi mantiqiy.
- iMentorga yangidan Direction/Group/Student qo'shish ikkita joyda bir xil ma'lumotni saqlash
  (sync muammosi, eskirish xavfi) degani — buni tanlamaymiz.

**Yakuniy zanjir:** `Kafedra → Direction (Yo'nalish) → Group (Guruh) → AppUser (Talaba)`,
to'liq OnlineTest bazasida, FK bilan.

## 3. Bosqichlar

### Bosqich 1 — OnlineTest: `Kafedra` modeli

**Fayl:** `backend/apps/core/models/user.py` (yoki alohida `department.py`, keyin `__init__.py`ga export)

```python
class Kafedra(models.Model):
    name = models.CharField(max_length=200, unique=True)
    code = models.CharField(max_length=50, unique=True, blank=True)
    sort_order = models.PositiveSmallIntegerField(default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        app_label = "core"
        db_table = "kafedralar"
        ordering = ["sort_order", "name"]
```

`Direction` modeliga FK qo'shish:

```python
class Direction(models.Model):
    name = models.CharField(max_length=200, unique=True)
    kafedra = models.ForeignKey(
        "Kafedra", null=True, blank=True, on_delete=models.SET_NULL,
        db_column="kafedra_id", related_name="directions",
    )
    ...
```

`kafedra` boshida **nullable** — mavjud `Direction` qatorlari buzilmasligi uchun (eski yo'nalishlar
kafedrasiz qoladi, keyin admin panel orqali to'ldiriladi).

**Migration:** `python manage.py makemigrations core -n add_kafedra` → keyingi raqam
`0028_add_kafedra.py` (oxirgi migration: `0027_exam_ambient_audio_toggle.py`).

### Bosqich 2 — OnlineTest: admin CRUD API (Kafedra)

**Namuna:** `admin_directions` / `admin_direction_detail` (`apps/api/views/admin.py:598-660`) —
xuddi shu naqsh bo'yicha `admin_kafedralar` / `admin_kafedra_detail` yoziladi:

- `GET/POST /api/admin/kafedralar` — ro'yxat / yaratish
- `GET/PATCH/DELETE /api/admin/kafedralar/<pk>` — detail/tahrirlash/o'chirish
  (o'chirishda bog'liq `Direction` bor-yo'qligini tekshirish — `direction_has_kafedra` xatosi,
  `direction_has_groups`ga o'xshab)

`admin_directions` javobiga `kafedra_id`/`kafedra_name` qo'shiladi (hozir faqat `.values()` bilan
qaytaradi — `kafedra_id` avtomatik chiqadi, `kafedra_name` uchun `select_related` kerak bo'ladi).

URL: `apps/api/urls.py`ga qo'shish (48-51 qatorlar yonida):
```python
path("admin/kafedralar", views.admin_kafedralar),
path("admin/kafedralar/<int:pk>", views.admin_kafedra_detail),
```

### Bosqich 3 — OnlineTest admin frontend (React)

OnlineTest frontendida Direction/Group boshqarish sahifasi bor joyga (`frontend/src/...` —
"Yo'nalishlar"/"Guruhlar" boshqaruvi) yangi **"Kafedralar"** bo'limi qo'shiladi: ro'yxat, qo'shish,
tahrirlash, o'chirish. Yo'nalish yaratish/tahrirlash formasiga **Kafedra tanlash** dropdown
qo'shiladi (`direction_id` yaratilayotganda `kafedra_id` ham tanlanadi).

### Bosqich 4 — OnlineTest: iMentor uchun ochiq (public) katalog API

Hozir `imentor → onlinetest` yo'nalishida faqat login bor (`/api/auth/login`). Kafedra/Yo'nalish/
Guruh katalogini iMentor o'qishi uchun **yangi, faqat o'qish uchun** endpoint kerak, X-Api-Key
autentifikatsiyasi bilan (OnlineTest'ning iMentorga savol berayotgan tomonidagi
`IMENTOR_API_KEY`ga o'xshab, lekin teskari yo'nalishda — buning uchun alohida kalit:
`IMENTOR_CONSUMER_API_KEY` yoki mavjud `IMENTOR_EXTERNAL_API_KEYS` mexanizmidan foydalanish,
qarang `imentor/backend/.env.example:8`, iMentor tomonida shunga o'xshash `X-Api-Key` tekshiruvi
bor — `apps/api/permissions.py`dagi namunaga qarab OnlineTest tomonida ham xuddi shunday tekshiruv
yoziladi).

**Yangi endpoint:** `GET /api/public/academic-catalog/` (yoki `/api/catalog/tree/`) — javob:

```json
{
  "kafedralar": [
    {"id": 1, "name": "Ichki kasalliklar kafedrasi", "directions": [
      {"id": 3, "name": "Davolash ishi", "groups": [
        {"id": 12, "name": "101-guruh", "level": "1-kurs", "student_count": 24}
      ]}
    ]}
  ]
}
```

Bu — iMentor tomonida dropdown/filtr uchun to'liq daraxt. Alohida flat endpointlar ham foydali
bo'lishi mumkin (`/api/public/kafedralar/`, `/api/public/directions/`, `/api/public/groups/`) —
qaysi birini tanlash iMentor UI ehtiyojiga qarab hal qilinadi (bosqich 6da aniqlanadi).

### Bosqich 5 — iMentor: klient funksiyasi

**Fayl:** `imentor/backend/core/online_test_client.py` — hozir faqat `online_test_login()` bor
(25-67 qatorlar). Xuddi shu naqsh bilan yangi funksiya qo'shiladi:

```python
def fetch_academic_catalog(*, timeout: float = 12.0) -> dict:
    base = online_test_api_base()
    if not base:
        raise OnlineTestAuthError("ONLINE_TEST_API_BASE_URL sozlanmagan.", status_code=503)
    url = urljoin(base + "/", "api/public/academic-catalog/")
    res = requests.get(url, timeout=timeout, headers={"X-Api-Key": settings.ONLINE_TEST_CONSUMER_KEY})
    ...
```

Bu ma'lumotni keshlash kerak (masalan Redis, TTL 5-10 daqiqa) — har so'rovda OnlineTestga
urilmaslik uchun (`imentor/backend` da Redis allaqachon bor — `docker-compose.prod.yml`).

### Bosqich 6 — iMentor: frontendda ishlatish

Hozir `StaffProfile`/`ClinicalGroupMember`dagi erkin matn `faculty/department/direction/
study_group` maydonlari — bu API tayyor bo'lgach, dropdown orqali (matn emas, ID orqali) tanlanadi.
Aniq qaysi ekranlarda kerakligini (StaffProfile tahrirlash formasi, ClinicalGroupMember qo'shish
formasi, boshqa joylar) shu bosqichda alohida tekshirib chiqamiz — hozircha ro'yxatga olib
qo'yamiz, PROGRESS.md da kuzatiladi.

### Bosqich 7 — Eski matn maydonlarini tozalash (ixtiyoriy, keyingi safar)

`StaffProfile.faculty/department/direction/study_group` erkin matnlarini yangi FK/ID maydonlarga
migratsiya qilish — bu breaking change, alohida rejalashtiriladi, hozirgi bosqichga kirmaydi.

### Bosqich 8 — Test bazasi (imtihon) yaratish oqimini Direction bilan integratsiya qilish

**Muammo**: OnlineTest'da imtihon yaratishda "variant" tanlash (masalan `PI`, `DI`) va
iMentor'dagi `CourseSyllabus.variants` — ikkalasi ham bir xil ko'rinishdagi qisqa kodlar
ishlatadi, lekin ular orasida **hech qanday haqiqiy bog'lanish yo'q**, faqat tasodifiy bir
xil yozilgan matn:

- OnlineTest tomonida (`apps/api/views/admin.py`, `imentor_service.py:284-464`): admin
  iMentordan fan tanlaydi, iMentor o'sha fan uchun qaytargan `variant_labels` ro'yxatidan
  birini tanlaydi — bu qiymat **oddiy matn** (`variant_label`) sifatida `Exam.imentor_subject_codes`
  JSON ichida saqlanadi, hech qanday jadvalga tekshirilmaydi.
- iMentor tomonida (`backend/core/models.py:101-138`, `CourseSyllabus.variants` — JSONField):
  bu ham erkin matn — fan syllabusi yuklanganda admin qo'lda yozgan yorliq
  (`"Bir fan ichida bir nechta yo'nalish PDF: PI, DI, TPI"`), `Direction` modeliga
  bog'lanmagan.
- Guruh tayinlash (`ExamGroup`, `views/admin.py:1418-1422,1592-1600`): admin imtihonga
  guruhlarni **bittalab, qo'lda** tanlaydi — Direction bo'yicha filtr yoki "shu yo'nalishdagi
  barcha guruhlarni tanlash" degan tugma yo'q.

**Yechim** (Bosqich 1-2, ya'ni `Direction` OnlineTest'da to'liq shakllangandan keyin
bajariladi):

1. **`Exam`ga `direction` FK qo'shiladi** (OnlineTest'ning o'z `Direction` jadvalidan) —
   hozirgi erkin matn `variant_label` dropdown o'rniga.
2. iMentordan fan/variant so'ralganda, qaytgan `variant_labels` OnlineTest'ning
   `Direction.name` qiymatlariga **tekshiriladi** (validatsiya) — mos kelmasa xato
   qaytariladi, tasodifiy noto'g'ri qiymat saqlanmaydi.
3. **`ExamGroup` guruh tanlash Direction bilan filtrlanadi**: `Exam.direction` tanlangach,
   guruh multi-select ro'yxati avtomatik `Group.objects.filter(direction=exam.direction)`
   bilan cheklanadi, va **"shu yo'nalishdagi barcha guruhlarni tanlash"** tugmasi qo'shiladi
   (hozir har safar bittalab tanlash kerak).
4. **iMentor tomonida (ixtiyoriy, keyinroq)**: `CourseSyllabus.variants` ichidagi har bir
   yorliqqa barqaror `direction_code` maydoni qo'shilsa, ikkala tizim endi "tasodifiy bir
   xil matn"ga emas, balki OnlineTest'ning `Direction.name`siga solishtiriladigan aniq
   kodga tayanadi.

**Bog'liqlik**: bu bosqich Bosqich 1-2 (`Kafedra`/`Direction` modeli) va Bosqich 0
(kontingent import, `Direction` real ma'lumot bilan to'lishi) tugagandan keyin
boshlanadi — hozircha `Direction` OnlineTest'da yangi va bo'sh, avval haqiqiy
ma'lumot bilan to'ldirilishi kerak.

---

## 6. Bosqich 0 — Talabalar kontingentini import qilish + yillik kurs ko'tarilishi

Amaliy ehtiyojdan kelib chiqib, Kafedra ishidan oldin bajariladigan qo'shimcha bosqich
(`data/talablar kotingenti/*.xlsx` fayllarni real bazaga kiritish uchun).

### 6.1 Manba ma'lumot tahlili

5 ta Excel fayl (1-5 kurslar), struktura fayldan-faylga farq qiladi:

| Fayl | Ustunlar | Qatorlar |
|---|---|---|
| `1-kurs.xlsx` | Ism, Pasport, Talaba ID, JSHSHIR, **Guruh**, Rasm | 1968 |
| `2-kurs.xlsx` | Ism, Pasport, JSHSHIR, Talaba ID, Kurs, **Guruh** | 1685 |
| `3- kurs.xlsx` | 2 sheet: "xalqaro" (ko'p bo'sh qator) + "Talabalar" (Guruh yo'q) | 1073+256 |
| `4 kurslar.xlsx` | Talaba ID, Ism, Pasport, JSHSHIR, Kurs, **Fakultet** (to'liq nom), Guruh, Til | 764 |
| `5 kurslar.xlsx` | Talaba ID, Ism, Pasport, JSHSHIR, Guruh, Rasm | 483 |

**Guruh nomlash qoidasi**: `<YO'NALISH_KODI>-<GURUH_RAQAMI>`, masalan `TPI-925` →
yo'nalish kodi `TPI`, guruh raqami `925`. Prefikslar: `TPI, DI, MD, PI, FT, OHI, S, F, BM, XT`
(ba'zi qatorlarda guruh o'rniga kafedra/mutaxassislik nomi yozilgan — ordinatura/magistratura
talabalari, alohida holat sifatida qayta ishlanadi).

**Qaror**: Direction uchun to'liq nom lug'ati (`DIRECTION_CODE_MAP`) **hozircha yozilmaydi** —
kod (`TPI`, `DI`, ...) to'g'ridan-to'g'ri `Direction.name` sifatida saqlanadi. To'liq nomga
o'tish keyinchalik bitta joyda (`Direction.name` UPDATE) qilinishi mumkin, hech narsani
buzmaydi.

**Rasm ustuni**: `1-kurs/2-kurs/3-kurs/4-kurs.xlsx`da rasm ustuni `#VALUE!` xato ko'rsatadi —
sabab: bu fayllar rasmni Excel/365'ning yangi **"Picture in Cell" (Rich Data)** funksiyasi
orqali saqlagan (`xl/richData/...`), `openpyxl` buni klassik drawing sifatida o'qiy olmaydi.
Rasmlarning o'zi ZIP ichida (`xl/media/imageN.jpg`) **butun saqlangan** — masalan
`1-kurs.xlsx`da 1968 ta JPG, ~180MB (shuning uchun fayl hajmi 772MB). Import qilishda
matn ma'lumot birinchi navbatda ko'chiriladi; rasmlarni chiqarish uchun `richValueRel.xml` /
`rdrichvalue.xml` orqali qator↔rasm bog'lanishini o'qiydigan alohida skript kerak bo'ladi —
bu alohida, keyingi kichik vazifa.

### 6.2 Yillik kurs ko'tarilishi (fayllar sentyabrda eskiradi)

Muammo: 2026-yil 2-avgustda "1-kurs" deb import qilingan talabalar sentyabrda avtomatik
"2-kurs"ga o'tishi kerak, lekin hozirgi modelda buni ta'minlaydigan hech narsa yo'q — `Level`
shunchaki statik matn (`"1-kurs"`), avtomatik ko'tarilish mexanizmi yo'q.

**Qabul qilingan yechim**: `Group.intake_year` (qabul yili, masalan `2025`) maydoni orqali
joriy kursni **hisoblab chiqarish**, guruh nomi/tarkibini o'zgartirmasdan:

```
current_level_number = joriy_o'quv_yili - intake_year + 1
```

Har yil **1-sentyabrda** ishlaydigan `promote_groups` buyrug'i barcha faol guruhlarning
`Level` FK'sini shu formulaga qarab yangilaydi. Agar hisoblangan kurs oxirgi kursdan katta
bo'lsa (masalan tibbiyotda 6-kursdan keyin), guruh **bitirgan** deb belgilanadi
(`Group.is_active=False` — bu maydon hali qo'shilmagan, `promote_groups` yozilganda qo'shiladi),
`Level`ga tegilmaydi. Guruh nomi (`TPI-925`) va talabalar tarkibi o'zgarmaydi — faqat `Level`
FK yiliga qarab ko'tariladi.

**Holat**: `Group.intake_year` va `Group.is_active` maydonlari qo'shildi (migration
`0028_add_group_intake_year.py`, `0029_add_group_is_active.py`), admin API
(`admin_groups`/`admin_group_detail`)da `intake_year` o'qish/yozish qo'llab-quvvatlanadi.
`promote_groups` buyrug'i yozildi
(`apps/core/management/commands/promote_groups.py`):

```
python manage.py promote_groups                                   # dry-run
python manage.py promote_groups --apply
python manage.py promote_groups --as-of-date 2026-09-01            # sana simulyatsiyasi
python manage.py promote_groups --max-level-overrides "S:5,F:5,TPI:5" --apply
```

Mantiq: `current_level = joriy_o'quv_yili_boshi - intake_year + 1`, bunda
`joriy_o'quv_yili_boshi` — 1-sentyabrgacha o'tgan yil, 1-sentyabrdan keyin joriy yil.
Maksimal kursdan oshgan guruh `is_active=False` qilinadi, `Level`ga tegilmaydi. Har
o'zgarish `AuditLog`ga yoziladi (`actor_id="system"`). Hali **serverda haqiqiy
ma'lumot bilan sinovdan o'tkazilmagan** (DB ulanishi bo'lmagani sababli) va **yillik
avtomatik ishga tushirish (cron)** sozlanmagan.

### 6.3 Import buyrug'i (`import_students`) — 10 talabada sinovdan o'tdi

`apps/core/management/commands/import_students.py` yozildi: dry-run default, `--apply`
bilan yozadi, idempotent (`get_or_create`/`update_or_create`), guruh nomini
`GROUP_RE` bilan parslaydi (mos kelmasa alohida ro'yxatga chiqaradi, o'tkazib yuboradi).
Talaba paroli: **yangi yaratilgan foydalanuvchi uchun talaba ID bilan bir xil**
(mavjud foydalanuvchining paroli tegilmaydi).

```
python manage.py import_students --file "data/talablar kotingenti/1-kurs.xlsx" \
    --level-name 1-kurs --intake-year 2025 --limit 10 --apply
```

**Sinov natijasi** (lokal Docker Postgres, keyin tozalab qo'yildi): `1-kurs.xlsx`dan
10 ta talaba muvaffaqiyatli yaratildi (`TPI-925` guruhi, `TPI` yo'nalishi avtomatik
yaratildi), va **haqiqiy HTTP login sinovi** (`POST /api/auth/login`, ID=parol=talaba ID)
muvaffaqiyatli o'tdi. `openpyxl` kutubxonasi `requirements/base.txt`ga qo'shildi.

**Keyingi qadam**: butun kontingentni (5 fayl, ~6000 talaba) real serverda import qilish —
har fayl uchun to'g'ri `--intake-year` tanlash kerak (masalan `1-kurs.xlsx`→2025,
`2-kurs.xlsx`→2024 va h.k., sentyabrgacha bo'lgan holatga ko'ra).

---

## 4. Muhim qarorlar / ochiq savollar

- Bitta `Direction` bir nechta kafedraga tegishli bo'la oladimi? — **Yo'q**, 1 ta yo'nalish = 1 ta
  kafedra (ForeignKey, ManyToMany emas), chunki hozircha ko'p-ko'plik ehtiyoji ko'rinmadi.
- Bitta hodim bir nechta kafedrada ishlashi mumkinmi? — bu `StaffProfile` bilan bog'liq, alohida
  savol, Bosqich 6/7da hal qilinadi, hozirgi Kafedra→Yo'nalish→Guruh→Talaba zanjiriga ta'sir
  qilmaydi.
- API autentifikatsiya kaliti nomi va joyi — Bosqich 4 boshlanishida aniqlanadi.

## 5. Fayllar ro'yxati (taxminiy, amalga oshirish paytida aniqlashadi)

| Bosqich | Loyiha | Fayl |
|---|---|---|
| 0 | onlinetest | `models/user.py` (`intake_year`, `is_active`), `promote_groups.py`, `import_students.py` |
| 1 | onlinetest | `backend/apps/core/models/user.py`, yangi migration |
| 2 | onlinetest | `backend/apps/api/views/admin.py`, `backend/apps/api/urls.py` |
| 3 | onlinetest | `frontend/src/...` (Kafedralar sahifasi) |
| 4 | onlinetest | `backend/apps/api/views/public.py` (yangi), `urls.py` |
| 5 | imentor | `backend/core/online_test_client.py` |
| 6 | imentor | tegishli frontend formalar (aniqlanadi) |
| 7 | imentor | keyingi safar, breaking change |
| 8 | onlinetest + imentor | `Exam` modeli (`direction` FK), `views/admin.py` (ExamGroup filtri), `ImtixonTab.tsx`, ixtiyoriy: `CourseSyllabus.variants` (`direction_code`) |

Progress kuzatuvi: [`PROGRESS.md`](PROGRESS.md)
