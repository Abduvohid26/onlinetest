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
- [ ] Butun kontingent (4 fayl) **serverning haqiqiy bazasida** `--apply` bilan import qilindi
- [ ] `promote_groups` uchun yillik avtomatik ishga tushirish (cron/scheduled task, har 1-sentyabr)

**Hal qilinmagan muammolar (import oldidan yoki keyin ko'rib chiqiladi):**
- `3-kurs.xlsx` → "Talabalar" sheet (1073 talaba): "Guruh" ustuni yo'q — manba aniqlanishi kerak.
- `3-kurs.xlsx` → "xalqaro" sheet: 256 qatorning barchasi bo'sh (shablon, real ma'lumot yo'q) — e'tiborsiz qoldiriladi.
- Har faylda 1-2 tadan "Morfologiya-NN (Magistratura/uzbek)" kabi ordinatura/magistratura guruh nomlari — avtomatik o'tkazib yuboriladi, keyin qo'lda ko'rib chiqiladi.

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

**Oxirgi yangilanish:** 2026-08-02 — Bosqich 0 asosan tayyor: `intake_year`/`is_active`
maydonlari, `promote_groups` va `import_students` buyruqlari yozildi, 10 talabada real
sinov (login bilan) muvaffaqiyatli o'tdi. Bosqich 8 (test bazasi integratsiyasi) rejaga
qo'shildi. Keyingi qadam: butun kontingentni serverda import qilish yoki Bosqich 1
(Kafedra modeli)ga o'tish.
