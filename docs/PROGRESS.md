# Progress — Kafedra → Yo'nalish → Guruh → Talaba ierarxiyasi

To'liq reja: [`KAFEDRA_HIERARCHY_PLAN.md`](KAFEDRA_HIERARCHY_PLAN.md)

Holat belgilari: `[ ]` boshlanmagan · `[~]` jarayonda · `[x]` tayyor

## Bosqich 0 — Talabalar kontingentini import qilish + yillik kurs ko'tarilishi
(Reja tuzilgandan keyin, amaliy ehtiyojdan kelib chiqib qo'shildi — batafsili: PLAN.md §6)
- [x] `data/talablar kotingenti/*.xlsx` fayllar tahlil qilindi (fieldlar, guruh nomlash qoidasi, rasm holati)
- [x] `Group.intake_year` maydoni qo'shildi (`backend/apps/core/models/user.py`)
- [x] Migration yaratildi (`0028_add_group_intake_year.py`) — **serverda hali ishga tushirilmagan (`migrate` kerak)**
- [x] `admin_groups` / `admin_group_detail` API'ga `intake_year` qo'shildi (GET/POST/PATCH)
- [x] `Group.is_active` maydoni qo'shildi (migration `0029_add_group_is_active.py`) — **serverda hali ishga tushirilmagan**
- [x] `promote_groups` management command yozildi (`apps/core/management/commands/promote_groups.py`) — dry-run default, `--apply` bilan yozadi, `AuditLog`ga yozadi
- [ ] `promote_groups` real bazada sinovdan o'tkazildi (dry-run) — DB ulanishi yo'qligi sababli hali tekshirilmagan
- [x] `import_students` management command yozildi (`apps/core/management/commands/import_students.py`) — `openpyxl` qo'shildi (`requirements/base.txt`)
- [x] 10 ta talaba bilan sinov o'tkazildi (lokal Docker Postgres): `TPI-925` guruh yaratildi, HTTP login (ID=parol) tasdiqlandi, test yozuvlari tozalab tashlandi
- [x] `GROUP_RE` tuzatildi — endi faqat katta harfli kod (TPI, DI, MD...) qabul qilinadi, ordinatura/magistratura nomlari (masalan "Kardiologiya-25") avtomatik chetlab o'tiladi
- [x] `scripts/import_full_kontingent.sh` orkestrator skripti yozildi (barcha 5 faylni ketma-ket ishga tushiradi, `--apply` bilan yoki dry-run)
- [x] To'liq dry-run sinovi o'tkazildi (lokal Postgres): 1-kurs=1609, 2-kurs=1367, 4-kurs=764, 5-kurs=483 talaba — jami ~4223 ta, hech narsa yozilmadi (0 xato holida)
- [x] Frontend UI (`GroupsPage.tsx`, `types.ts`, `i18n.ts`) `intake_year` va `is_active` (bitirgan) ko'rsatish/kiritishni qo'llab-quvvatlaydigan qilindi
- [ ] **3-kurs.xlsx hali import qilinmagan** — "Talabalar" sheet'da "Guruh" ustuni umuman yo'q, qo'lda hal qilish kerak (pastga qarang)
- [x] Butun kontingent (4 fayl) **serverning haqiqiy bazasida** `--apply` bilan import qilindi (`kontingent.py`, konteyner ichida) — natija: **4226 talaba, 303 guruh, 15 yo'nalish** (`TPI, FT, BM, OHI, DI, ЛД, MD, SSBJSS, RTT, TBATM, P, S, F, PI, XT`). Haqiqiy HTTP login (`/api/auth/login`, ID=parol) muvaffaqiyatli tasdiqlandi.
- [ ] `promote_groups` uchun yillik avtomatik ishga tushirish (cron/scheduled task, har 1-sentyabr)

**Hal qilinmagan muammolar (import oldidan yoki keyin ko'rib chiqiladi):**
- `3-kurs.xlsx` → "Talabalar" sheet (1073 talaba): "Guruh" ustuni yo'q — manba aniqlanishi kerak.
- `3-kurs.xlsx` → "xalqaro" sheet: 256 qatorning barchasi bo'sh (shablon, real ma'lumot yo'q) — e'tiborsiz qoldiriladi.
- Har faylda 1-2 tadan "Morfologiya-NN (Magistratura/uzbek)" kabi ordinatura/magistratura guruh nomlari — avtomatik o'tkazib yuboriladi, keyin qo'lda ko'rib chiqiladi.

### 0.1 — Talaba rasmlari (`profile_image`)

**Sabab**: `apps/api/views/student.py:409-414` — imtihon boshlashdan oldin `profile_image`
kamida 50 belgi bo'lishi **majburiy** (`403 profile_photo_required`). Import qilingan
4226 talabaning barchasida bu maydon bo'sh edi.

**Topilma**: Excel fayllardagi "Rasm"/"Foto"/"Talaba rasmi" ustunlari `openpyxl`da
`#VALUE!` ko'rsatadi, lekin bu — Excel/365'ning **"Picture in Cell" (Rich Data)**
funksiyasi, rasmning o'zi faylda (`xl/media/*`) **butun saqlangan**. Qator↔rasm
bog'lanishi maxsus XML zanjiri orqali tiklanadi: `xl/worksheets/sheet1.xml`
(katakning `vm=` atributi, 1-based) → `xl/metadata.xml` (`<xlrd:rvb i=N/>`) →
`xl/richData/rdrichvalue.xml` (rv indeks, `s="0"`=lokal / `s="1"`=web-rasm) →
`xl/richData/richValueRel.xml` + `_rels/richValueRel.xml.rels` → haqiqiy
`xl/media/imageN.{png,jpg}` fayli. Rasm ustuni har faylda avtomatik aniqlanadi
(eng ko'p `vm=` bor ustun).

- [x] `apps/core/management/commands/seed_student_photos.py` yozildi — rich-data
  zanjirini o'qiydi, `PIL` bilan JPEG'ga o'giradi (uzun tomon max 600px, sifat 82 —
  1.6MB'lik original ~45KB base64'ga tushadi, 2MB chegaradan xavfsiz past), faqat
  `profile_image` bo'sh bo'lgan talabalarga o'rnatadi (`--overwrite` bilan majburlash
  mumkin).
- [x] 10 talabada sinov (lokal Docker Postgres): barcha 10 tasi to'g'ri rasm bilan
  mos keldi (vizual tekshirildi — asl va bazadagi JPEG bir xil odam), keyin tozalab
  tashlandi.
- [x] `kontingent.py`ga `--photos` flag qo'shildi — har fayl uchun talaba import
  qilingandan keyin xuddi o'sha faylning rasmlarini ham biriktiradi
  (`python kontingent.py --apply --photos`). Dry-run rejimida barcha 4 fayl uchun
  tezlik tekshirildi (~2-3 daqiqa, muammosiz).
- [ ] Butun kontingentga (production) rasmlar `--apply --photos` bilan o'rnatildi —
  hali bajarilmagan, keyingi qadam.
- [ ] 3-kurs.xlsx uchun rasmlar (guruh muammosi hal bo'lgandan keyin, alohida)

## Bosqich 1 — OnlineTest: Kafedra modeli
- [ ] `Kafedra` modeli qo'shildi (`backend/apps/core/models/user.py`)
- [ ] `Direction.kafedra` FK qo'shildi (nullable)
- [ ] Migration yaratildi va ishga tushirildi

## Bosqich 2 — OnlineTest: admin CRUD API
- [ ] `admin_kafedralar` / `admin_kafedra_detail` view'lari yozildi
- [ ] URL'lar qo'shildi (`apps/api/urls.py`)
- [ ] `admin_directions` javobiga `kafedra_id`/`kafedra_name` qo'shildi

## Bosqich 3 — OnlineTest admin frontend
- [ ] "Kafedralar" boshqaruv sahifasi (ro'yxat/qo'shish/tahrirlash/o'chirish)
- [ ] Yo'nalish formasiga "Kafedra" dropdown qo'shildi

## Bosqich 4 — OnlineTest: iMentor uchun ochiq katalog API
- [ ] Autentifikatsiya kaliti mexanizmi tanlandi
- [ ] `GET /api/public/academic-catalog/` (yoki tanlangan shakl) yozildi va test qilindi

## Bosqich 5 — iMentor: klient funksiyasi
- [ ] `fetch_academic_catalog()` qo'shildi (`imentor/backend/core/online_test_client.py`)
- [ ] Keshlash (Redis, TTL) qo'shildi

## Bosqich 6 — iMentor: frontendda ishlatish
- [ ] Qaysi ekranlar aniqlandi (StaffProfile, ClinicalGroupMember, ...)
- [ ] Dropdown'lar ID asosida ishlaydigan qilindi

## Bosqich 7 — Tozalash (keyingi safar, alohida reja kerak)
- [ ] Rejalashtirilmagan — hozircha kutilmoqda

## Bosqich 8 — Test bazasi (imtihon) yaratish oqimini Direction bilan integratsiya qilish
(Bosqich 1-2 va Bosqich 0 to'liq tugagandan keyin boshlanadi — batafsili: PLAN.md §"Bosqich 8")
- [ ] `Exam`ga `direction` FK qo'shildi (OnlineTest)
- [ ] iMentordan kelgan `variant_labels` `Direction.name`ga tekshiriladigan (validatsiya) qilindi
- [ ] `ExamGroup` guruh tanlash `Exam.direction` bo'yicha filtrlanadigan qilindi
- [ ] "Shu yo'nalishdagi barcha guruhlarni tanlash" tugmasi qo'shildi
- [ ] (ixtiyoriy) iMentor `CourseSyllabus.variants`ga barqaror `direction_code` qo'shildi

---

**Oxirgi yangilanish:** 2026-08-02 — Bosqich 0 **serverda muvaffaqiyatli yakunlandi**:
butun kontingent (3-kurs.xlsx dan tashqari) production bazasiga import qilindi
(4226 talaba, 303 guruh, 15 yo'nalish), real login tasdiqlandi. Deploy jarayonida
ikkita amaliy muammo hal qilindi: (1) `docker-compose.yml`ga `app` xizmati uchun
`./data:/app/data:ro` bind mount qo'shildi — chunki `data/` .gitignore'da bo'lgani
uchun image build'ga kirmaydi, va `docker cp` orqali qo'yilgan fayllar konteyner
qayta yaratilganda yo'qolgan edi; (2) `backend/kontingent.py` — barcha 4 faylni
bitta buyruq bilan (`python kontingent.py [--apply]`) ishga tushiradigan sof
Python skript (bash o'rniga, konteyner ichida `manage.py` joylashuvidan qat'iy
nazar ishlaydi). Keyingi qadam: 3-kurs.xlsx uchun guruh manbasini aniqlash,
yoki Bosqich 1 (Kafedra modeli)ga o'tish.
