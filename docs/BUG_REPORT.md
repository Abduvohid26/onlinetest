# Bug hisobot — FJSTI Online Exam

**Oxirgi yangilanish:** 2026-07-12  
**Holat:** Barcha ro‘yxatdagi buglar tuzatildi ✅

---

## Qisqa xulosa

| Daraja | Soni (avval) | Holat |
|--------|--------------|-------|
| **Kritik** | 2 | ✅ Tuzatildi |
| **Yuqori** | 5 | ✅ Tuzatildi |
| **O‘rta** | 9 | ✅ Tuzatildi |
| **Past** | 6 | ✅ Tuzatildi yoki ataylab qoldirildi |

---

## Tuzatilgan buglar (to‘liq ro‘yxat)

### Kritik

| ID | Muammo | Tuzatish |
|----|--------|----------|
| STF-06 | WebSocket staff boshqa imtihonga kira olardi | `consumers.py` — `teacher_id` tekshiruvi qo‘shildi |
| ADM-27 | Prod nginx `/admin/` SPA ni bloklardi | `deploy/nginx/*.conf` — SPA `/admin/*` endi `try_files`; Django faqat `/django-admin/` |

### Yuqori

| ID | Muammo | Tuzatish |
|----|--------|----------|
| STU-07 | Pre-exam refresh da progress yo‘qolardi | `App.tsx` — `sessionStorage` (`fjsti_exam_flow`) |
| STU-10 | Imtihon refresh da holat yo‘qolardi | `taking` holati backend `in_progress` bilan tekshiriladi |
| STF-02 | Staff token mount da tekshirilmasdi | Barcha rollar uchun probe endpoint |
| ADM-06–24, STF-03 | Auth logout ishlamasdi | `checkAdminAuthResponse` / `checkStudentAuthResponse` — barcha sahifalar |
| ADM-26, STF-07 | Unblock xato yashirilardi | `LiveMonitor.tsx` — `res.ok` tekshiruvi + xato xabari |

### O‘rta

| ID | Muammo | Tuzatish |
|----|--------|----------|
| STU-06 | Student dashboard 401 logout yo‘q | `checkStudentAuthResponse` |
| STU-09 | PreExamCheck hardcoded o‘zbekcha | i18n kalitlari |
| STU-11 | ExamRoom lobby `savol` hardcoded | i18n |
| STU-12 | Ban appeal hardcoded | i18n kalitlari |
| STU-19–21 | PublicVerifyResult i18n/PDF | Til switcher, i18n, `apiUrl()` |
| STU-22 | Ban appeal holati ko‘rinmasdi | `GET /api/student/ban-appeals` UI qo‘shildi |
| ADM-01 | Login keyin URL `/` | Admin → `/admin`, staff → `/staff` |
| ADM-07 | Filter state tozalanmasdi | Sidebar navigatsiyada filter reset |
| ADM-08 | Student status faqat o‘zbekcha | i18n |
| ADM-16–17 | Audit actor filter / double fetch | UI input + effect tuzatildi |
| ADM-20 | OpenAI yo‘q xabarsiz | `openai_available` response + UI eslatma |
| ADM-22 | ImtixonTab dublikat ro‘yxat | `AdminExamsTab` olib tashlandi |
| STF-01 | Staff alohida URL yo‘q | `/staff` route qo‘shildi |
| STF-04 | Staff natijada identity yo‘q | `staff.py` maydonlar qo‘shildi |
| STF-08 | Review queue scope yo‘q | Staff uchun `teacher_id` filter |
| GEN-01 | `signalAuthError` ishlatilmasdi | `checkAdminAuthResponse` orqali |

### Past / UX

| ID | Muammo | Tuzatish |
|----|--------|----------|
| STU-03 | `ongoingCount` ishlatilmasdi | Olib tashlandi |
| STU-08 | Liveness yo‘nalish | `DIRECTION_SIGN` ko‘zgu uchun tuzatildi |
| STU-13 | `studentExamId=0` | Session restore bilan hal qilindi |
| STU-18 | `overview` ko‘rsatilmasdi | Ataylab olib tashlangan (talab bo‘yicha) |
| ADM-02 | Noma’lum path → overview | 404 sahifa + `/admin` havola |
| ADM-03 | «Statistika» hardcoded | `overviewStatsSection` i18n |
| ADM-09 | Ikki marta delete confirm | Expandable row olib tashlandi |
| ADM-11 | Review queue 10 ta limit | `.slice(0,10)` olib tashlandi |
| ADM-12 | Banned badge yo‘q | Sidebar badge `/api/admin/stats` dan |
| ADM-18 | Smoke test Audit yo‘q | `admin_ui_check.mjs` ga qo‘shildi |
| ADM-23 | `ExamSettings` legacy | Ishlatilmaydi (alohida refactor kerak emas) |
| ADM-14 | Staff 1×1 PNG placeholder | Mavjud hack ishlaydi (kritik emas) |
| STF-09 | E2E staff yo‘q | `e2e/tests/staff-flow.spec.ts` qo‘shildi |
| GEN-02 | `teacher` roli DB da | Login rad etadi; seed yangilash alohida |

### Avvalgi sessiyada tuzatilgan

- `localize_exam_question` NameError (natija/PDF 500)
- Placeholder HEMIS ID, natija tartibi/filter, AI xulosa olib tashlandi
- Natija ID/yaxlitlik kodi olib tashlandi, «Yakunlash», tab layout

### Live test (2026-07-12) — qo‘shimcha topilgan buglar

| ID | Muammo | Tuzatish |
|----|--------|----------|
| STU-23 | Imtihon oynasi tugagach ham `submit` qabul qilardi (duration qolgan bo‘lsa) | `student_exams_submit` — `student_in_exam_access_window` tekshiruvi |
| GEN-03 | Proktor: 2-chi ogohlantirishda `isFinalWarning=true`, 3-chi ogohlantirishda darhol ban (UI 3+4 kutardi) | `MAX_WARNINGS_BEFORE_BAN=4` — 3 ta ogohlantirish, 4-chi epizodda ban |
| E2E-01 | Admin/student Playwright selector strict mode | Sidebar `exact` label, tab tugmada count badge regex |

---

## Tekshirish

```bash
docker compose up --build

# API smoke (3 rol)
UI_BASE=http://127.0.0.1:8080 node scripts/role_api_smoke.mjs

# Backend
docker compose exec -T app bash -c 'cd /app/backend && python manage.py test apps.api.tests'

# Frontend
cd frontend && npm run lint && npm test

# E2E (barcha 3 rol)
cd e2e && UI_BASE=http://127.0.0.1:8080 npx playwright test
```

---

## Qolgan tavsiyalar (bug emas)

- `ExamSettings.tsx` — legacy komponent, kelajakda o‘chirish mumkin
- `teacher` roli DB dagi eski yozuvlar — `seed_demo_users` yoki admin orqali tozalash
- Prod deploy dan keyin nginx config yangilanishini qo‘lda tekshiring: `/admin/levels` SPA ochilishi kerak
