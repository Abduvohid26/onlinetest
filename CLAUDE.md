# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

FJSTI Online Exam — remote exam platform for a medical education institute. Monorepo: Django REST API backend (`backend/`) + React/Vite SPA frontend (`frontend/`), with Django Channels for real-time WebRTC/proctoring signaling and Celery for background AI tasks. Full functional spec (in Uzbek): `docs/TEXNIK_TALABLAR.md`.

Roles: `admin`, `staff` (proctor/observer), `student`. Auth is stateless JWT (HS256), not Django sessions — see Authentication below.

## Commands

### Run everything (preferred — Docker is the only supported local workflow)
```bash
docker compose up --build
```
App: http://127.0.0.1:8080 · Django admin: http://127.0.0.1:8080/admin/ (`admin` / `AdminLocal123`)
Demo logins (password `DemoFJSTI2026!`): `demo_admin`, `demo_staff`, `demo_student`.
Services: `app` (API+SPA), `db` (PostgreSQL), `redis`, `worker` (Celery).

### Backend (from `backend/`)
```bash
python manage.py check                          # config sanity
python manage.py check --deploy                 # prod-like checks (used in CI)
python manage.py makemigrations --check --dry-run  # verify no missing migrations
python manage.py test apps.api.tests -v 1        # full backend test suite
python manage.py test apps.api.tests.test_integration.ExamFlowApiTests.test_login_returns_jwt_and_role  # single test
pip install -r requirements/dev.txt              # local (non-Docker) dev install
```
Requires PostgreSQL — **SQLite is not supported**, in dev, test, or prod (`DATABASE_URL` must point at Postgres; `settings.py` raises `RuntimeError` otherwise). Minimum env for a bare `manage.py` run: `DJANGO_SECRET_KEY`, `JWT_SECRET`, `DATABASE_URL` (see `backend/.env.example`).

### Frontend (from `frontend/`)
```bash
npm run dev            # Vite dev server
npm run lint            # tsc --noEmit (this repo's "lint" is a typecheck, not eslint)
npm test                # runs tests/*.test.ts via node --test (tsx loader)
npm run test:watch
npm run build
```
There is no per-test-file CLI flag configured; to run one file directly: `node --import tsx --test tests/examQuestionUtils.test.ts`.

### Root-level convenience scripts
```bash
npm run build:front     # node scripts/check-node.mjs && cd frontend && npm run build
npm run ci:backend      # cd backend && python manage.py check && python manage.py test apps.api.tests -v 1
```
Node version is pinned (`.nvmrc`/`.node-version`, `engines: ">=20.19 <23"`); `scripts/check-node.mjs` enforces it on `npm install`/build.

### CI
`.github/workflows/ci.yml` — three jobs: `frontend` (npm audit, typecheck, unit tests, build), `backend` (pip-audit, `manage.py check`, missing-migrations check, `check --deploy`, test suite), `realtime-smoke` (boots ASGI app under uvicorn, hits `/api/health`).

## Architecture

### Backend layout (`backend/apps/`)
- **`core`**: the data layer only — models (`core/models/{user,exam,bank,student_exam,violation}.py`), migrations, Django admin, request-context middleware, deploy-time checks (`checks.py`). No views/business logic lives here.
- **`api`**: everything else. Views are split by audience under `api/views/`: `public.py`, `auth.py`, `student.py`, `student_results.py`, `staff.py`, `admin.py`, `health.py`, plus shared helpers in `_helpers.py`. All URL routes are registered flatly in `api/urls.py` (no per-view-module includes) and exposed for import via `api/views/__init__.py`.
- Single ASGI entrypoint (`exam_platform/asgi.py`) serves both DRF HTTP views and the Channels WebSocket route (`api/routing.py` → `ws/realtime/`). There is no separate Node/Socket.IO server — `api/consumers.py`'s `ExamRealtimeConsumer` is a from-scratch WebRTC signaling relay (join_exam/offer/answer/ice_candidate) that replaced one.

### Authentication & authorization
- Custom `JWTAuthentication` (`api/authentication.py`) reads `Authorization: Bearer <token>`, decodes with `settings.JWT_SECRET`, then **re-fetches the user from the DB** — the JWT's `role`/`name` claims are never trusted for authorization, only `id`. A banned user's tokens still authenticate but are rejected except for two ban-appeal endpoints.
- Role checks are DRF permission classes in `api/permissions.py` (`IsAuthenticatedStrict`, `IsAdmin`, `IsStudent`) plus ad-hoc `request.user.role == "..."` checks in view bodies (e.g. staff can only see exams where `teacher_id == request.user.id`).
- The WebSocket consumer independently re-verifies the same JWT (query-string `?token=`) since Channels doesn't go through DRF auth.

### Anti-cheat / proctoring ("VAC" — Virtual Anti-Cheat)
- Toggle switches live in `api/vac_settings.py`, default **on** in production, off in dev, individually overridable via env (`VAC_HMAC_GUARD`, `VAC_SEQ_GUARD`, `VAC_CHALLENGE_GUARD`, `VAC_DEVICE_LOCK`, `VAC_PC_ONLY`).
- Guards enforced server-side during an exam session: HMAC-signed clock requests, monotonic request sequence numbers, rotating challenge headers, and device fingerprint binding (`StudentExam.device_fingerprint`/`session_signing_key`/`session_challenge` fields) — these stop replayed/tampered requests from a second device, not just client-side JS checks.
- HMAC nonce replay cache and the Channels layer both need a shared, cross-worker store in production: **Redis is required** once `WEB_CONCURRENCY > 1` (falls back to `FileBasedCache`/`InMemoryChannelLayer` otherwise, which breaks live proctoring across workers). `check --deploy` fails with `exam.E001` if `REDIS_URL` is unset in prod unless `ALLOW_INMEMORY_CHANNELS=1` is explicitly set for a deliberately single-process deploy.
- Violations (tab-switch, camera loss, identity mismatch, etc.) accumulate into warnings/bans — see `core/models/violation.py` and the violation tests in `test_integration.py` (dedup rules: same violation type spam within a window is deduped; distinct types within a minute count once; three distinct warnings → ban on the fourth).

### AI integrations
- `api/gemini_tools.py` — question parsing/classification from uploaded documents (PDF/DOCX/images), language detection, EN/UZ/RU translation, AI exam-result summaries, MCQ paraphrasing. This is the primary AI surface (despite the module name, check `openai_client.py` for the actual configured provider/model via `OPENAI_API_KEY`/`OPENAI_MODEL`/`OPENAI_VISION_MODEL`).
- `api/face_embedding.py` — local OpenCV-based face detection/embedding comparison (identity verification, live proctor frame analysis), used as an engine independent of the AI text pipeline.
- **`proctor-frame` analysis runs via Celery** (`api/tasks.py`), not inline in the request/response cycle: the endpoint returns `202 {task_id}` and the frontend polls `GET .../proctor-frame/{task_id}`. If no broker is configured (`REDIS_URL`/`CELERY_BROKER_URL` unset — typical for dev/test), `CELERY_TASK_ALWAYS_EAGER=True` makes tasks run synchronously so the same code path works without a worker. `identity-compare` (pre-exam identity check) is still synchronous by design (one-shot, blocking is acceptable).
- All AI features are soft-optional: absence of `OPENAI_API_KEY` degrades gracefully (features skipped / fallback parser) rather than failing hard — see `openai_client.api_key_configured()` and `test_admin_test_bank_import_smart_no_gemini_uses_fallback_parser`.

### Frontend (`frontend/src/`)
- Single-page app, client-side routed in `App.tsx` (react-router-dom v7) with one component per role dashboard: `AdminDashboard.tsx`, `StaffDashboard.tsx`, `StudentDashboard.tsx`, plus shared flows `Login.tsx`, `PreExamCheck.tsx` (camera/device checks before entry), `ExamRoom.tsx` (the timed exam-taking session), `PublicVerifyResult.tsx` (QR-code result/certificate verification, no auth).
- `pages/admin/` holds admin sub-tabs (Overview, Students, Groups, Levels, Staff, Audit, Banned).
- Auth token/user are kept in `sessionStorage` by default; only whitelisted keys move to `localStorage` when "remember me" is used — passwords are never persisted client-side (see `App.tsx`'s `storageFor`/`SESSION_KEYS`).
- MediaPipe assets (WASM + face/hand/object models) are **self-hosted**: `frontend/scripts/sync-mediapipe-assets.mjs` runs on `predev`/`prebuild`, copies the WASM runtime out of `node_modules` and downloads the three SHA256-pinned models into `public/mediapipe/` (cached in `frontend/vendor/`, both gitignored). `lib/mediapipeAssets.ts` tries the **CDN first and the local copy as fallback** (`VITE_MEDIAPIPE_LOCAL_FIRST=1` flips it): local-first was tried in production and MediaPipe failed to initialise from the local WASM, taking all real-time proctoring down, so the proven path leads. nginx serves `/mediapipe/` from the static block with `try_files $uri =404` — without that it fell through to `location /` and a missing model returned `index.html` with a 200; if every source fails the engines report `onReady(false)`, the student sees a degraded-monitoring banner and the client POSTs `/api/student/proctor-engine-status` so `StudentExam.proctor_engine_status` shows it in Django admin. Same pattern as the Silero VAD assets (`sync-vad-assets.mjs`).
- MediaPipe inference **can** run in a Web Worker, but it is **off by default** (`VITE_PROCTOR_WORKER=1` enables it) — it is unproven in production and a broken worker means no real-time proctoring at all (`lib/proctorWorker.ts` + `lib/proctorWorkerClient.ts`); only inference moves, all decision logic (gaze thresholds, escalation, violations) stays on the main thread, so changing detection rules never touches the worker. Frames cross as transferable `ImageBitmap`. `ProctorWorkerClient.create()` returns `null` — never throws — when the flag is unset, when the browser lacks Worker/createImageBitmap/OffscreenCanvas, or when init times out; callers then fall back to the original main-thread path, so the worst case equals the pre-worker behavior. Requires `worker: { format: 'es' }` in `vite.config.ts` (the worker dynamically imports `@mediapipe/tasks-vision`, which Vite's default `iife` worker format cannot code-split).
- **Gaze thresholds are learned, not hardcoded** (`lib/gazeMapping.ts`). Every exam click pairs the click's normalized screen position with that frame's gaze features (iris dx/dy + head yaw/pitch), and a ridge-regressed linear model maps features -> screen coordinates; `classifyGaze` then reports which screen edge the gaze crossed. Safety margins derive from fit residuals, so a noisy camera automatically gets a looser threshold. The fit is rejected (`NOT_ENOUGH_SAMPLES` / `NO_SPREAD` / `DEGENERATE` / `POOR_FIT`) rather than trusted blindly, and `RealtimeProctor.setGazeModel(null)` falls back to the original hardcoded constants — so proctoring is never weaker than it was pre-model. Resizing the window or leaving fullscreen invalidates the model silently (no student-visible re-calibration) but records `proctor_gaze_status='lost'` on `StudentExam` via `/api/student/proctor-engine-status`, so deliberately resizing to disable gaze control stays visible to admins.
- `VITE_GAZE_DEBUG=1` renders `components/GazeDebugPanel.tsx` above the camera panel: live iris dx/dy plotted against the current thresholds, plus head pose and per-direction escalation timers. Dev-only tuning aid, never shown to students.
- `lib/` holds the proctoring client stack: `useServerProctoring.ts`/`useRealtimeProctoring.ts` (hooks orchestrating camera capture + server calls), `realtimeSocket.ts`/`realtimeProctor.ts` (the WebSocket signaling client matching `consumers.py`'s protocol), `deviceFingerprint.ts`, `facePositionCheck.ts`, `voiceActivity.ts`, `compressToJpeg.ts` (frame compression before upload).
- `apiUrl()` (`lib/apiUrl.ts`) resolves relative `/api/...` paths by default; set `VITE_API_BASE_URL` only when frontend and backend are on different domains.

### Deployment
Docker Compose is the only supported path for local dev (no bare-metal Node/Python/Postgres setup is documented or expected to work smoothly). Production deploy scripts and docs live in `deploy/` (`deploy/DEPLOY.md`, GitHub Actions variant, nginx configs, systemd units for the web + Celery worker processes, `deploy/remote-update.sh` for in-place server updates).
