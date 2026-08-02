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
- [x] `Kafedra` modeli qo'shildi (`backend/apps/core/models/user.py`) — `name` (unique),
  `code` (unique, **null=True** — ikkita bo'sh kod bir-biriga to'qnashmasligi uchun),
  `sort_order`, `is_active`
- [x] `Direction.kafedra` FK qo'shildi (nullable, `SET_NULL`, `related_name="directions"`)
- [x] `apps/core/models/__init__.py`ga eksport qilindi
- [x] Migration yaratildi (`0030_add_kafedra.py`) — lokal Docker Postgres'da sinovdan
  o'tkazildi (2 ta kafedra, biri bo'sh kod bilan — `unique` xato bermadi; `Direction`ga
  FK biriktirish ishladi), keyin tozalab tashlandi. **Serverda hali ishga tushirilmagan.**
- Django admin panelida ro'yxatdan o'tkazilmadi — `Direction` ham ro'yxatdan o'tmagan
  (ataylab, chunki Bosqich 2/3da maxsus admin API/UI orqali boshqariladi)

## Bosqich 2 — OnlineTest: admin CRUD API
- [x] `admin_kafedralar` (GET/POST) va `admin_kafedra_detail` (GET/PATCH/DELETE)
  view'lari yozildi (`apps/api/views/admin.py`) — `admin_directions`/`admin_direction_detail`
  bilan bir xil naqsh (validatsiya, `audit()`, bog'liq yozuv bo'lsa o'chirishga to'siq)
- [x] URL'lar qo'shildi: `admin/kafedralar`, `admin/kafedralar/<int:pk>` (`apps/api/urls.py`)
- [x] `admin_directions` (GET/POST) va `admin_direction_detail` (GET/PATCH/DELETE)
  `kafedra_id`/`kafedra_name` bilan yangilandi — POST/PATCHda `kafedra_id` validatsiya
  qilinadi (mavjud bo'lmasa 400)
- [x] `Kafedra` `_helpers.py` orqali eksport qilindi (wildcard import zanjiri)
- [x] Xato xabarlari qo'shildi (`admin_api_i18n.py`): `kafedra_name_exists`,
  `kafedra_code_exists`, `kafedra_not_found`, `kafedra_has_directions` (uz/ru/en)
- [x] **To'liq HTTP sinovi** (lokal Docker Postgres, real `runserver` + admin token):
  kafedra yaratish (kod bilan/kodsiz), direction'ni kafedra bilan yaratish,
  `direction_count` hisoblash, bog'liq kafedrani o'chirishga to'siq (400),
  uzish (`kafedra_id: null`) + muvaffaqiyatli o'chirish (200) — barchasi to'g'ri
  ishladi. Test paytida bitta bug topilib tuzatildi: PATCH'da `old_name`
  o'zgartirishdan OLDIN emas, KEYIN o'qilayotgan edi (audit logda ma'nosiz
  bo'lardi) — tuzatildi. Test ma'lumotlari va vaqtinchalik admin parol
  tozalab/tiklab qo'yildi.

## Bosqich 3 — OnlineTest admin frontend
- [x] `KafedralarPage.tsx` yozildi (`frontend/src/pages/admin/`) — `DirectionsPage.tsx`
  bilan bir xil naqsh (CRUD, inline edit/delete, bog'liq yozuv bo'lsa o'chirishga
  to'siq), qo'shimcha `code` maydoni bilan
- [x] `types.ts`ga `Kafedra` turi va `Direction.kafedra_id`/`kafedra_name` qo'shildi
- [x] `DirectionsPage.tsx`ga "Kafedra" dropdown qo'shildi (qo'shish formasi +
  inline tahrirlash), ro'yxatda `kafedra_name` ko'rsatiladi
- [x] `AdminDashboard.tsx`ga yangi sahifa ulandi: `AdminPage` turi, `PAGE_PATHS`
  (`/admin/kafedralar`), sidebar nav item ("Darajalar" bilan "Yo'nalishlar"
  orasida), render bloki
- [x] i18n: uz/ru/en uchta tilda barcha yangi matnlar qo'shildi
  (`kontingentKafedralar`, `kafedraLabel`, `kafedraHasDirections`, ...)
- [x] `tsc --noEmit` va `npm run build` — ikkalasi ham toza (xatosiz)
- [x] **To'liq brauzer E2E sinovi** (real Vite dev server + Django + lokal Postgres,
  haqiqiy admin login orqali): "Kafedralar" menyusi ko'rindi → kafedra yaratildi
  (kod bilan) → "Yo'nalishlar" sahifasida yangi kafedra dropdown'da chiqdi →
  yo'nalish shu kafedra bilan yaratildi → ro'yxatda "TESTDIR — UI Test Kafedra ·
  0 Guruhlar" to'g'ri ko'rindi → Kafedralar sahifasida "1 Yo'nalishlar" to'g'ri
  yangilandi → bog'liq kafedrani o'chirishga urinishda to'g'ri ogohlantirish
  chiqdi (o'chirish bloklandi). Test ma'lumotlari va vaqtinchalik admin parol
  tozalab/tiklab qo'yildi.

### 3.1 — Kafedra ro'yxatini boshlang'ich to'ldirish

- [x] `apps/core/management/commands/seed_kafedralar.py` yozildi — 46 ta kafedra
  nomini bir martada yaratadi (manba: Excel fayllardagi ordinatura/magistratura
  guruh nomlaridan chiqarilgan, imlo xatolari va yil/til variantlari tozalangan,
  masalan "Kardiologiya-25 (Magistratura) rus" → "Kardiologiya"). Idempotent
  (`get_or_create`), dry-run default. Lokal Postgres'da sinovdan o'tkazildi:
  birinchi ishga tushirishda 46 yangi, ikkinchisida 0 yangi/46 mavjud — to'g'ri.
- [ ] Serverda `--apply` bilan ishga tushirilmagan — keyingi qadam.

**⚠️ Ochiq kontseptual savol — Kafedra↔Direction bog'lanishi**: mavjud 15 ta
`Direction` (`TPI, DI, MD, PI, S, F, OHI, FT, BM, XT, RTT, SSBJSS, TBATM, P, ЛД`)
— bular **bakalavriat yo'nalishlari**. Yangi 46 ta `Kafedra` esa Excel'dagi
**ordinatura/magistratura** mutaxassislik nomlaridan chiqarilgan — bular boshqa
daraja/miqyos (bitta bakalavriat yo'nalishini odatda o'nlab kafedra birgalikda
o'qitadi, faqat bittasiga tegishli emas). Foydalanuvchi bilan aniqlashtirilgan
qaror: **hozircha bog'lashni qo'lda, admin panel orqali (Yo'nalishlar sahifasi
→ Tahrirlash → Kafedra tanlash) amalga oshiramiz**, keyinroq qayta ko'rib
chiqiladi — avtomatik/skript bilan bog'lash qilinmaydi (chunki to'g'ri xarita
faqat foydalanuvchi/dekanatga ma'lum).

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

**Oxirgi yangilanish:** 2026-08-02 — Bosqich 0, 1, 2, 3 **kod darajasida tayyor**
(0 — serverda ham yakunlangan, 1-3 — hali faqat lokal sinovdan o'tgan, serverga
tushirilmagan). Bosqich 1-3 (Kafedra→Direction zanjiri: model, admin API, admin
frontend) real brauzer E2E sinovidan muvaffaqiyatli o'tdi — kafedra yaratish,
yo'nalishga bog'lash, hisoblangan `direction_count`, bog'liq yozuvni o'chirishga
to'siq — barchasi ishlab chiqarish sifatida tekshirildi. Keyingi qadam: Bosqich
1-3'ni serverga chiqarish (migration + deploy), so'ng Bosqich 4 (iMentor uchun
ochiq katalog API)ga o'tish, yoki 3-kurs.xlsx uchun guruh manbasini aniqlash.
