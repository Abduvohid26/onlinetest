"""Talaba imtihon oqimi: identity, start/submit, draft, violations, proctoring."""
from __future__ import annotations

from apps.api.views._helpers import *  # noqa: F401,F403
from apps.api.tasks import analyze_proctor_frame_task
from apps.api.services import auto_finalize_student_exam_if_expired, bank_row_to_exam_dict_multilingual, fill_missing_exam_translations

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer


def _notify_banned(student_id: str, student_name: str, student_exam_id: int, exam_id: int, reason: str, violations_count: int) -> None:
    """Ban bo'lganda WebSocket orqali exam group'ga xabar yuborish."""
    try:
        layer = get_channel_layer()
        if layer:
            async_to_sync(layer.group_send)(
                f"exam_{exam_id}",
                {
                    "type": "exam.student_banned",
                    "student_id": student_id,
                    "student_name": student_name,
                    "student_exam_id": student_exam_id,
                    "exam_id": exam_id,
                    "reason": reason,
                    "violations_count": violations_count,
                },
            )
    except Exception:
        pass  # WS xatosi ban jarayonini to'xtatmasin


def _notify_student_unblocked(
    student_id: str,
    student_exam_id: int,
    exam_id: int,
    *,
    can_retake: bool = True,
    unblocked_by: str | None = None,
) -> None:
    """Admin ban yechganda talabaga WebSocket orqali xabar."""
    try:
        layer = get_channel_layer()
        if layer:
            payload: dict = {
                "type": "exam.student_unblocked",
                "student_id": str(student_id),
                "student_exam_id": student_exam_id,
                "exam_id": exam_id,
                "can_retake": can_retake,
            }
            if unblocked_by:
                payload["unblocked_by"] = str(unblocked_by)
            async_to_sync(layer.group_send)(f"exam_{exam_id}", payload)
    except Exception:
        pass


@api_view(["POST"])
@throttle_classes([FaceVerifyThrottle])
@permission_classes([IsAuthenticated])
def student_identity_compare(request):
    u = request.user
    log_identity("identity_compare_enter", user_id=getattr(u, "id", None), role=getattr(u, "role", None))
    if not _is_student_user(u):
        log_identity("identity_reject", reason="STUDENT_ONLY", user_id=getattr(u, "id", None))
        return Response(
            {"error": "Forbidden", "code": "STUDENT_ONLY"},
            status=403,
        )
    body = request.data or {}
    p_raw = body.get("profile_image_base64")
    l_raw = body.get("live_capture_base64")
    if not isinstance(p_raw, str) or not isinstance(l_raw, str):
        log_identity("identity_reject", reason="invalid_body", user_id=u.id)
        return Response({"error": "Invalid body"}, status=400)

    def strip(s: str) -> str:
        t = s.strip()
        return t.split(",", 1)[1].strip() if "," in t else t

    p, l = strip(p_raw), strip(l_raw)
    max_b64 = 14 * 1024 * 1024
    if len(p) < 80 or len(l) < 80 or len(p) > max_b64 or len(l) > max_b64:
        log_identity(
            "identity_reject",
            reason="invalid_image_payload",
            user_id=u.id,
            profile_len=len(p),
            live_len=len(l),
        )
        return Response({"error": "Invalid image payload"}, status=400)
    exam_id_raw = body.get("exam_id")
    eid: int | None = None
    se: StudentExam | None = None
    if exam_id_raw is not None and exam_id_raw != "":
        try:
            eid = int(exam_id_raw)
        except (TypeError, ValueError):
            return Response({"error": "Invalid exam_id"}, status=400)
        if not Exam.objects.filter(pk=eid).exists():
            return Response({"error": "Exam not found"}, status=404)
        if not _student_assigned_to_exam(u, eid):
            return Response(
                {"error": "Forbidden", "code": "EXAM_NOT_ASSIGNED"},
                status=403,
            )
        se = StudentExam.objects.filter(student_id=u.id, exam_id=eid).first()
        if se and (se.status or "").strip() == "In Progress":
            if not _request_has_exam_session_guard(request):
                _reset_abandoned_in_progress(se)
                se.refresh_from_db()
            else:
                mismatch = _enforce_bound_device_or_403(se, request)
                if mismatch is not None:
                    body = getattr(mismatch, "data", None) or {}
                    if isinstance(body, dict) and "code" not in body:
                        body = {**body, "code": "DEVICE_MISMATCH"}
                        return Response(body, status=mismatch.status_code)
                    return mismatch
                sig_err = _verify_exam_hmac_or_403(se, request)
                if sig_err is not None:
                    return sig_err
    elif identity_verify_required():
        return Response(
            {"error": "exam_id is required for identity verification", "code": "EXAM_ID_REQUIRED"},
            status=400,
        )
    log_identity(
        "identity_request",
        student_id=u.id,
        exam_id=eid,
        profile_b64_len=len(p),
        live_b64_len=len(l),
    )
    result = compare_faces(p_raw, l_raw)
    if not result.get("success"):
        code = result.get("code") or "GEMINI_ERROR"
        log_identity(
            "identity_api_fail",
            student_id=u.id,
            exam_id=eid,
            code=code,
            detail=(result.get("detail") or "")[:200],
        )
        bypass = settings.DEBUG and os.environ.get("ALLOW_IDENTITY_VERIFY_BYPASS", "").strip().lower() in (
            "1",
            "true",
            "yes",
        )
        if bypass and code in (
            "GEMINI_UNAVAILABLE",
            "GEMINI_ERROR",
            "GEMINI_MODEL_INVALID",
            "FACE_ENGINE_UNAVAILABLE",
        ):
            log_identity("identity_bypass", student_id=u.id, exam_id=eid, code=code)
            resp = Response({"match": True, "skipped": True, "code": code}, status=200)
            if eid is not None:
                se_row, _ = StudentExam.objects.get_or_create(
                    student_id=u.id,
                    exam_id=eid,
                    defaults={"status": "Pending"},
                )
                se_row.identity_verified_at = dj_tz.now()
                se_row.save(update_fields=["identity_verified_at"])
            return _exam_guarded_response(request, resp) if se else resp
        log_identity("identity_http_503", student_id=u.id, exam_id=eid, code=code)
        return Response({"match": False, "skipped": False, "code": code}, status=503)
    matched = bool(result.get("match"))
    log_identity(
        "identity_result",
        student_id=u.id,
        exam_id=eid,
        match=matched,
        verified_saved=matched and eid is not None,
        ai_note="NO_MATCH — kameraga to'g'ri qarang" if not matched else "OK",
    )
    if matched and eid is not None:
        se_row, _ = StudentExam.objects.get_or_create(
            student_id=u.id,
            exam_id=eid,
            defaults={"status": "Pending"},
        )
        se_row.identity_verified_at = dj_tz.now()
        se_row.save(update_fields=["identity_verified_at"])
    resp = Response(
        {
            "match": matched,
            "skipped": False,
            "score": result.get("score"),
            "method": result.get("method"),
            **({"code": result.get("code")} if not matched and result.get("code") else {}),
        }
    )
    return _exam_guarded_response(request, resp) if se else resp


# --- Admin: users ---
@api_view(["GET"])
@permission_classes([IsAuthenticated])
def student_exams_list(request):
    u = request.user
    if not _is_student_user(u):
        return Response({"error": "Forbidden"}, status=403)
    if not u.group_id:
        return Response([])
    assigned_ids = list(
        ExamGroup.objects.filter(group_id=u.group_id).values_list("exam_id", flat=True).distinct()
    )
    if not assigned_ids:
        return Response([])
    exams_qs = Exam.objects.filter(pk__in=assigned_ids).order_by("-id")
    ses_by_exam = {
        se.exam_id: se
        for se in StudentExam.objects.filter(student_id=u.id, exam_id__in=assigned_ids)
    }
    out = []
    for e in exams_qs:
        se = ses_by_exam.get(e.id)
        if se is not None and (se.status or "").strip() == "In Progress":
            if auto_finalize_student_exam_if_expired(se, e, str(u.id)):
                se.refresh_from_db()
                ses_by_exam[e.id] = se
        if se is not None and se.status in ("Completed", "Banned"):
            continue
        in_progress = se is not None and (se.status or "").strip() == "In Progress" and bool(se.started_at)
        out.append(
            {
                "id": e.id,
                "title": e.title,
                "start_time": e.start_time.isoformat() if e.start_time else None,
                "end_time": e.end_time.isoformat() if e.end_time else None,
                "duration_minutes": e.duration_minutes,
                "language": e.language,
                "has_pin": bool(e.pin),
                "custom_rules": e.custom_rules,
                "exam_mode": e.exam_mode,
                "bank_question_count": e.bank_question_count,
                "in_progress": in_progress,
                "started_at": se.started_at.isoformat() if in_progress and se.started_at else None,
            }
        )
    return Response(out)
@api_view(["POST"])
@permission_classes([IsAuthenticated])
def student_exams_start(request, pk: int):
    u = request.user
    if not _is_student_user(u):
        return Response({"error": "Forbidden"}, status=403)
    pin = (request.data or {}).get("pin")
    exam = Exam.objects.filter(pk=pk).first()
    if not exam:
        return Response({"error": "Exam not found"}, status=404)
    if exam.pin and exam.pin != pin:
        return Response({"error": "Invalid PIN"}, status=403)
    if not ExamGroup.objects.filter(exam_id=pk, group_id=u.group_id).exists():
        return Response({"error": "Exam not assigned to your group"}, status=403)

    if vac_pc_only_enabled():
        ua = (request.META.get("HTTP_USER_AGENT") or "").lower()
        mobile_markers = ("android", "iphone", "ipad", "ipod", "mobile", "windows phone")
        if any(m in ua for m in mobile_markers):
            return Response(
                {
                    "error": "Faqat kompyuter (desktop/laptop) orqali imtihon topshirish ruxsat etiladi.",
                    "code": "VAC_PC_ONLY",
                },
                status=403,
            )

    ex_row = ExamStudentException.objects.filter(exam_id=pk, student_id=u.id).first()
    if ex_row:
        return Response({"error": ex_row.reason, "code": "EXAM_BLOCKED"}, status=403)

    stale = StudentExam.objects.filter(student_id=u.id, exam_id=pk).first()
    if stale is not None and (stale.status or "").strip() == "In Progress":
        if auto_finalize_student_exam_if_expired(stale, exam, str(u.id)):
            stale.refresh_from_db()

    now = dj_tz.now()
    in_general = bool(
        exam.start_time and exam.end_time and exam.start_time <= now <= exam.end_time
    )
    in_retake = ExamRetakeWindow.objects.filter(
        exam_id=pk, student_id=u.id, window_start__lte=now, window_end__gte=now
    ).exists()
    if not in_general and not in_retake:
        if exam.start_time and now < exam.start_time:
            return Response({"error": "Exam has not started yet"}, status=403)
        return Response({"error": "Exam has already ended"}, status=403)

    prof = AppUser.objects.filter(pk=u.id).values_list("profile_image", flat=True).first()
    if not prof or len(str(prof)) < 50:
        return Response(
            {"error": "Profil rasmsiz imtihon boshlash mumkin emas. Administratorga murojaat qiling."},
            status=403,
        )

    vac_device_lock = vac_device_lock_enabled()
    device_fp = _device_fp_from_request(request)
    if vac_device_lock and not device_fp:
        return Response(
            {"error": "Device fingerprint is required", "code": "DEVICE_FINGERPRINT_REQUIRED"},
            status=403,
        )

    pending_se = StudentExam.objects.filter(student_id=u.id, exam_id=pk).first()
    resuming = bool(
        pending_se
        and (pending_se.status or "").strip() == "In Progress"
        and pending_se.started_at
    )
    if (
        identity_verify_required()
        and not resuming
        and not _identity_verification_fresh(pending_se, now)
    ):
        return Response(
            {
                "error": "Yuz tekshiruvi talab qilinadi. Pre-exam bosqichini yakunlang.",
                "code": "IDENTITY_NOT_VERIFIED",
            },
            status=403,
        )

    device_token = secrets.token_urlsafe(32)
    with transaction.atomic():
        se = (
            StudentExam.objects.select_for_update()
            .filter(student_id=u.id, exam_id=pk)
            .first()
        )
        if not se:
            session_key = secrets.token_hex(32)
            session_challenge = secrets.token_hex(16)
            se = StudentExam.objects.create(
                student_id=u.id,
                exam_id=pk,
                status="In Progress",
                started_at=dj_tz.now(),
                device_fingerprint=device_fp if vac_device_lock else "",
                device_session_token=device_token if vac_device_lock else "",
                device_bound_at=dj_tz.now() if vac_device_lock else None,
                session_signing_key=session_key,
                session_request_seq=1,
                session_challenge=session_challenge,
            )
        elif se.status in ("Banned", "Completed"):
            return Response({"error": f"Exam already {se.status}"}, status=403)
        elif se.status == "Pending":
            se.status = "In Progress"
            se.started_at = dj_tz.now()
            se.proctor_official_warnings = 0
            se.proctor_last_warning_at = None
            if not se.session_signing_key:
                se.session_signing_key = secrets.token_hex(32)
            if not se.session_request_seq:
                se.session_request_seq = 1
            if not se.session_challenge:
                se.session_challenge = secrets.token_hex(16)
            if vac_device_lock:
                se.device_fingerprint = device_fp or se.device_fingerprint
                se.device_session_token = device_token
                se.device_bound_at = dj_tz.now()
            se.save(
                update_fields=[
                    "status",
                    "started_at",
                    "device_fingerprint",
                    "device_session_token",
                    "device_bound_at",
                    "session_signing_key",
                    "session_request_seq",
                    "session_challenge",
                    "proctor_official_warnings",
                    "proctor_last_warning_at",
                ]
            )
        elif se.status == "In Progress":
            if vac_device_lock:
                mismatch = _enforce_bound_device_or_403(se, request)
                if mismatch is not None:
                    if se.started_at and _try_rebind_device_for_resume(se, request, device_token, device_fp):
                        device_token = se.device_session_token or device_token
                        mismatch = None
                    elif not se.started_at and _student_exam_draft_is_empty(se):
                        se.device_fingerprint = device_fp or ""
                        se.device_session_token = device_token
                        se.device_bound_at = dj_tz.now()
                        se.started_at = now
                        se.proctor_official_warnings = 0
                        se.proctor_last_warning_at = None
                        mismatch = None
                    else:
                        return mismatch
            if not se.session_signing_key:
                se.session_signing_key = secrets.token_hex(32)
            if not se.session_request_seq:
                se.session_request_seq = 1
            if not se.session_challenge:
                se.session_challenge = secrets.token_hex(16)
            if vac_device_lock and not se.device_session_token:
                se.device_session_token = device_token
                if device_fp and not se.device_fingerprint:
                    se.device_fingerprint = device_fp
                    se.device_bound_at = dj_tz.now()
            else:
                device_token = se.device_session_token or device_token
            se.save(
                update_fields=[
                    "session_signing_key",
                    "session_request_seq",
                    "session_challenge",
                    "device_session_token",
                    "device_fingerprint",
                    "device_bound_at",
                    "started_at",
                    "proctor_official_warnings",
                    "proctor_last_warning_at",
                ]
            )

        retake_only = in_retake and not in_general
        if retake_only:
            # Retake oynasi — yangi sessiya sifatida boshlansin (eski ogohlantirishlar qoldig’i o’tmasin).
            se.started_at = now
            se.proctor_official_warnings = 0
            se.proctor_last_warning_at = None
            se.draft_answers_json = "{}"
            se.draft_flagged_json = "[]"
            retake_update_fields = [
                "started_at",
                "proctor_official_warnings",
                "proctor_last_warning_at",
                "draft_answers_json",
                "draft_flagged_json",
            ]
            if exam.exam_mode == "bank_mixed":
                se.session_questions_json = None
                retake_update_fields.append("session_questions_json")
            se.save(update_fields=retake_update_fields)

    full_questions: list[dict]
    student_lang = resolve_student_exam_language(request, exam)
    ex_lang = effective_exam_language(exam, student_lang)
    is_auto_exam = (exam.language or "uz").lower() == "auto"
    if exam.exam_mode == "bank_mixed":
        if se.session_questions_json:
            full_questions = safe_json_loads(se.session_questions_json, [])
            if is_auto_exam:
                upgraded = fill_missing_exam_translations(full_questions)
                if upgraded is not full_questions:
                    full_questions = upgraded
                    se.session_questions_json = json.dumps(full_questions)
                    se.save(update_fields=["session_questions_json"])
        else:
            n = max(8, exam.bank_question_count or 20)
            group = Group.objects.filter(pk=u.group_id).first() if u.group_id else None
            track = (group.program_track or "bachelor").lower() if group else "bachelor"
            if track in ("residency", "master"):
                n_ai = 0
                n_bank = n
            else:
                n_bank = int(n * 0.75)
                n_ai = n - n_bank
            cat_ids = safe_json_loads(exam.bank_category_ids, [])
            if not cat_ids:
                return Response({"error": "Invalid exam bank configuration"}, status=500)
            base_qs = TestBankQuestion.objects.filter(category_id__in=cat_ids).select_related(
                "category"
            )
            base_qs = filter_bank_questions_for_group(base_qs, group)
            pool_count = base_qs.count()
            if pool_count < n_bank:
                return Response(
                    {
                        "error": "Sizning guruhingiz (kurs/dastur) uchun tanlangan kategoriyalarda "
                        "yetarli savol yo'q. Administrator kategoriya yoki guruh sozlamalarini tekshirsin."
                    },
                    status=400,
                )
            picked_rows = list(base_qs.order_by("?")[:n_bank])
            if is_auto_exam:
                picked = [bank_row_to_exam_dict_multilingual(row) for row in picked_rows]
            else:
                picked = [bank_row_to_exam_dict(row, ex_lang) for row in picked_rows]
            if track == "bachelor" and picked:
                n_para = max(1, int(len(picked) * 0.25))
                idxs = list(range(len(picked)))
                shuffle_in_place(idxs)
                para_idxs = sorted(idxs[:n_para])
                # MUHIM: barcha tanlangan savollarni BITTA AI chaqiruvida paraphrase qilamiz.
                # (Avval har savol uchun alohida chaqirilardi — N ta ketma-ket Gemini so'rovi
                #  imtihon startini 10-30s sekinlashtirardi.)
                to_para = [picked[i] for i in para_idxs]
                try:
                    para_results = paraphrase_medical_mcqs(to_para, ex_lang)
                except Exception:
                    para_results = []
                if para_results and len(para_results) == len(to_para):
                    for pos, i in enumerate(para_idxs):
                        picked[i] = para_results[pos]
            elif track in ("residency", "master") and picked:
                try:
                    picked = paraphrase_medical_mcqs(picked, ex_lang)
                except Exception:
                    pass
            for i, qd in enumerate(picked):
                qd["id"] = i + 1
            cat_names = list(
                TestBankCategory.objects.filter(pk__in=cat_ids).values_list("name", flat=True)
            )
            samples = [{"text": q["text"], "options": q["options"], "correctAnswer": q["correctAnswer"]} for q in picked]
            ai_part: list[dict] = []
            if n_ai > 0:
                try:
                    ai_part = generate_bank_extension(samples, n_ai, ex_lang, list(cat_names))
                except Exception as ex:
                    import logging as _log

                    _log.getLogger(__name__).warning(
                        "generate_bank_extension failed (bank-only fallback): %s", ex
                    )
                    extra_pool = list(base_qs.order_by("?")[n_bank : n_bank + n_ai])
                    for row in extra_pool:
                        if is_auto_exam:
                            ai_part.append(bank_row_to_exam_dict_multilingual(row))
                        else:
                            ai_part.append(bank_row_to_exam_dict(row, ex_lang))
            next_id = len(picked) + 1
            ai_with_ids = [{**q, "id": next_id + j} for j, q in enumerate(ai_part)]
            merged = shuffle_in_place(picked + ai_with_ids)
            full_questions = [{**q, "id": idx + 1} for idx, q in enumerate(merged)]
            if is_auto_exam:
                full_questions = fill_missing_exam_translations(full_questions)
            se.session_questions_json = json.dumps(full_questions)
            se.save(update_fields=["session_questions_json"])
    else:
        full_questions = safe_json_loads(exam.questions_json, [])
        if is_auto_exam:
            full_questions = fill_missing_exam_translations(full_questions)

    full_questions = apply_exam_language_to_questions(
        full_questions, exam.language or "uz", student_lang
    )
    shuffled = build_student_question_list(full_questions)
    deadline = submission_deadline(exam, se, student_id=str(u.id))
    exam_out = {
        "id": exam.id,
        "teacher_id": exam.teacher_id,
        "title": exam.title,
        "start_time": exam.start_time.isoformat() if exam.start_time else None,
        "end_time": exam.end_time.isoformat() if exam.end_time else None,
        "duration_minutes": exam.duration_minutes,
        "language": ex_lang,
        "language_mode": exam.language,
        "pin": exam.pin,
        "custom_rules": exam.custom_rules,
        "exam_mode": exam.exam_mode,
        "questions": shuffled,
        "submission_deadline": deadline.isoformat() if deadline else None,
    }
    return Response(
        {
            "exam": exam_out,
            "studentExamId": se.id,
            "startedAt": se.started_at.isoformat() if se.started_at else None,
            "sessionKey": se.session_signing_key,
            "sessionSeqStart": int(se.session_request_seq or 1),
            "sessionChallenge": se.session_challenge,
            "deviceToken": device_token if vac_device_lock else None,
            "resumed": resuming,
        }
    )
@api_view(["POST"])
@permission_classes([IsAuthenticated])
def student_exams_submit(request, pk: int):
    u = request.user
    if not _is_student_user(u):
        return Response({"error": "Forbidden"}, status=403)
    answers = (request.data or {}).get("answers")
    flagged = (request.data or {}).get("flaggedQuestions")
    if not isinstance(answers, dict):
        return Response({"error": "Invalid answers format"}, status=400)
    if not Exam.objects.filter(pk=pk).exists():
        return Response({"error": "Exam not found"}, status=404)
    if not _student_assigned_to_exam(u, pk):
        return Response({"error": "Forbidden"}, status=403)

    with transaction.atomic():
        se = (
            StudentExam.objects.select_for_update()
            .filter(student_id=u.id, exam_id=pk)
            .select_related("exam")
            .first()
        )
        if not se or se.status != "In Progress":
            return Response({"error": "Cannot submit exam"}, status=403)
        mismatch = _enforce_bound_device_or_403(se, request)
        if mismatch is not None:
            return mismatch
        sig_err = _verify_exam_hmac_or_403(se, request)
        if sig_err is not None:
            return sig_err
        exam = se.exam
        now_submit = dj_tz.now()
        deadline = submission_deadline(exam, se, student_id=str(u.id))
        if deadline and now_submit > deadline:
            return Response(
                {"error": "Imtihon vaqti tugagan. Javoblar qabul qilinmaydi."},
                status=403,
            )
        min_sec = exam_min_submit_seconds()
        if min_sec > 0 and se.started_at:
            elapsed = (now_submit - se.started_at).total_seconds()
            if elapsed < min_sec:
                return Response(
                    {
                        "error": f"Imtihonni topshirish uchun kamida {min_sec} soniya kuting.",
                        "code": "SUBMIT_TOO_EARLY",
                    },
                    status=403,
                )
        if identity_verify_required() and not _identity_verification_fresh(se, now_submit):
            return Response(
                {"error": "Yuz tekshiruvi muddati tugagan.", "code": "IDENTITY_VERIFY_EXPIRED"},
                status=403,
            )
        if se.session_questions_json:
            questions = safe_json_loads(se.session_questions_json, [])
        else:
            questions = safe_json_loads(exam.questions_json, [])
        try:
            norm = validate_exam_answers(questions, answers)
        except ValueError as ex:
            return Response({"error": str(ex)}, status=400)
        score = sum(1 for q in questions if norm.get(str(q["id"])) == q.get("correctAnswer"))
        flagged_json = json.dumps(flagged) if flagged else "[]"
        completed_at = now_submit
        result_public_id = next_result_public_id()
        verify_secret = secrets.token_hex(32)
        total = len(questions)
        percentage = round((score / total) * 100) if total else 0
        ai_summary_json = json.dumps(build_fallback_ai_summary(questions, norm))
        se.status = "Completed"
        se.score = score
        se.answers_json = json.dumps(norm)
        se.flagged_questions_json = flagged_json
        se.completed_at = completed_at
        se.result_public_id = result_public_id
        se.result_verify_secret = verify_secret
        se.ai_summary_json = ai_summary_json
        se.draft_answers_json = "{}"
        se.draft_flagged_json = "[]"
        se.draft_updated_at = None
        se.save()

    completed_iso = completed_at.isoformat()
    icode = integrity_code(result_public_id, completed_iso, score, total, verify_secret)
    base = public_base_url(request)
    verify_url = f"{base}/verify/result/{result_public_id}?k={verify_secret}"
    ai_summary = safe_json_loads(ai_summary_json, {})
    per_q = []
    for q in questions:
        st = norm.get(str(q["id"]), "")
        ok = st == q.get("correctAnswer")
        ai_row = next((i for i in ai_summary.get("items", []) if i.get("questionId") == q["id"]), None)
        per_q.append(
            {
                "id": q["id"],
                "text": q.get("text"),
                "options": q.get("options"),
                "studentAnswer": st or None,
                "correctAnswer": q.get("correctAnswer"),
                "isCorrect": ok,
                "commentCorrect": (ai_row or {}).get("commentCorrect", "") if ok else "",
                "whyStudentWrong": "" if ok else (ai_row or {}).get("whyStudentWrong", ""),
                "whyCorrectIsRight": "" if ok else (ai_row or {}).get("whyCorrectIsRight", ""),
            }
        )
    return _exam_guarded_response(
        request,
        Response(
            {
                "success": True,
                "score": score,
                "total": total,
                "percentage": percentage,
                "exam_id": pk,
                "result_public_id": result_public_id,
                "verify_secret": verify_secret,
                "verify_url": verify_url,
                "integrity_code": icode,
                "completed_at": completed_iso,
                "overview": ai_summary.get("overview", ""),
                "questions": per_q,
            }
        ),
    )
@api_view(["GET"])
@permission_classes([IsAuthenticated])
def student_exam_clock(request, pk: int):
    u = request.user
    if not _is_student_user(u):
        return Response({"error": "Forbidden"}, status=403)
    exam = Exam.objects.filter(pk=pk).first()
    if not exam:
        return Response({"error": "Exam not found"}, status=404)
    if not _student_assigned_to_exam(u, pk):
        return Response({"error": "Forbidden"}, status=403)
    se = StudentExam.objects.filter(student_id=u.id, exam_id=pk).first()
    if not se or se.status != "In Progress":
        return Response({"error": "No active session"}, status=400)
    mismatch = _enforce_bound_device_or_403(se, request)
    if mismatch is not None:
        return mismatch
    sig_err = _verify_exam_hmac_or_403(se, request)
    if sig_err is not None:
        return sig_err
    deadline = submission_deadline(exam, se, student_id=str(u.id))
    now = dj_tz.now()
    sec = seconds_until_deadline(exam, se, student_id=str(u.id))

    # Liveness watchdog: nazorat kadrlari boshlangan, lekin uzoq vaqt kelmayotgan bo'lsa
    # (kamera o'chirilgan / oqim to'xtatilgan) — client PROCTOR_FEED_LOST loglaydi.
    liveness_gap = max(40, int(os.environ.get("PROCTOR_LIVENESS_MAX_GAP_SECONDS", "75")))
    feed_lost = bool(
        se.proctor_last_frame_at
        and (now - se.proctor_last_frame_at) > timedelta(seconds=liveness_gap)
    )

    return _exam_guarded_response(
        request,
        Response(
            {
                "server_now": now.isoformat(),
                "submission_deadline": deadline.isoformat() if deadline else None,
                "seconds_remaining": sec if sec is not None else 0,
                "proctorFeedLost": feed_lost,
            }
        ),
    )
@api_view(["GET"])
@permission_classes([IsAuthenticated])
def student_exam_draft(request, pk: int):
    u = request.user
    if not _is_student_user(u):
        return Response({"error": "Forbidden"}, status=403)
    if not Exam.objects.filter(pk=pk).exists():
        return Response({"error": "Exam not found"}, status=404)
    if not _student_assigned_to_exam(u, pk):
        return Response({"error": "Forbidden"}, status=403)
    se = StudentExam.objects.filter(student_id=u.id, exam_id=pk).first()
    if not se or se.status != "In Progress":
        return Response({"answers": {}, "flaggedQuestions": [], "updated_at": None})
    mismatch = _enforce_bound_device_or_403(se, request)
    if mismatch is not None:
        return mismatch
    sig_err = _verify_exam_hmac_or_403(se, request)
    if sig_err is not None:
        return sig_err
    answers = safe_json_loads(se.draft_answers_json, {})
    flagged = safe_json_loads(se.draft_flagged_json, [])
    return _exam_guarded_response(
        request,
        Response(
            {
                "answers": answers,
                "flaggedQuestions": flagged,
                "updated_at": se.draft_updated_at.isoformat() if se.draft_updated_at else None,
            }
        ),
    )
@api_view(["POST"])
@throttle_classes([ExamAutosaveThrottle])
@permission_classes([IsAuthenticated])
def student_exam_save_progress(request, pk: int):
    u = request.user
    if not _is_student_user(u):
        return Response({"error": "Forbidden"}, status=403)
    exam = Exam.objects.filter(pk=pk).first()
    if not exam:
        return Response({"error": "Exam not found"}, status=404)
    if not _student_assigned_to_exam(u, pk):
        return Response({"error": "Forbidden"}, status=403)
    se = StudentExam.objects.filter(student_id=u.id, exam_id=pk).first()
    if not se or se.status != "In Progress":
        return Response({"error": "No active session"}, status=400)
    mismatch = _enforce_bound_device_or_403(se, request)
    if mismatch is not None:
        return mismatch
    sig_err = _verify_exam_hmac_or_403(se, request)
    if sig_err is not None:
        return sig_err
    deadline = submission_deadline(exam, se, student_id=str(u.id))
    if deadline and dj_tz.now() > deadline:
        return Response({"error": "Imtihon vaqti tugagan"}, status=403)
    answers = (request.data or {}).get("answers")
    flagged = (request.data or {}).get("flaggedQuestions")
    if not isinstance(answers, dict):
        return Response({"error": "Invalid answers format"}, status=400)
    if flagged is not None and not isinstance(flagged, list):
        return Response({"error": "Invalid flagged format"}, status=400)
    if se.session_questions_json:
        q_list = safe_json_loads(se.session_questions_json, [])
    else:
        q_list = safe_json_loads(exam.questions_json, [])
    try:
        norm = validate_exam_answers(q_list, answers)
    except ValueError as ex:
        return Response({"error": str(ex)}, status=400)
    se.draft_answers_json = json.dumps(norm)
    if isinstance(flagged, list):
        se.draft_flagged_json = json.dumps(flagged)
    se.draft_updated_at = dj_tz.now()
    se.save(update_fields=["draft_answers_json", "draft_flagged_json", "draft_updated_at"])
    return _exam_guarded_response(
        request,
        Response({"ok": True, "saved_at": se.draft_updated_at.isoformat()}),
    )
@api_view(["POST"])
@throttle_classes([ViolationThrottle])
@permission_classes([IsAuthenticated])
def student_violations(request):
    u = request.user
    if not _is_student_user(u):
        return Response({"error": "Forbidden"}, status=403)
    d = request.data or {}
    exam_id, vtype_raw = d.get("exam_id"), d.get("violation_type")
    if exam_id is None or exam_id == "" or vtype_raw is None or vtype_raw == "":
        return Response({"error": "Missing required fields"}, status=400)
    if not isinstance(vtype_raw, str):
        return Response({"error": "Invalid violation_type"}, status=400)
    vtype = vtype_raw.strip()[:80]
    if not vtype:
        return Response({"error": "Invalid violation_type"}, status=400)
    screenshot = str(d.get("screenshot_url") or "")[:50_000]

    vac_strict_mode = str(os.environ.get("VAC_STRICT_MODE", "1")).strip() not in ("0", "false", "False")
    # Strict: faqat yuz almashtirish (identity) darhol ban; qolganlari 1-3 rasmiy ogohlantirish + hardening.
    # Masofaviy dastur / keng oyna+touch (false positive) uchun remote/devtools/virtual kamera ogohlantirish oqimiga o‘tadi.
    instant_ban_types = frozenset({"IDENTITY_SUBSTITUTION"}) if vac_strict_mode else frozenset()
    warn_types = frozenset(
        {
            "TAB_SWITCH_HARD",
            "TAB_SWITCH_SOFT",
            "FULLSCREEN_EXIT_HARD",
            "SUSPICIOUS_AUDIO",
            "WHISPER_OR_CONVERSATION_SUSPECTED",
            "CAMERA_MIC_ACCESS_FAILED",
            "VIRTUAL_WEBCAM_SUSPECTED",
            "FACE_NOT_VISIBLE",
            "MULTIPLE_FACES",
            "GAZE_AWAY_LEFT",
            "GAZE_AWAY_RIGHT",
            "GAZE_AWAY_UP",
            "GAZE_AWAY_DOWN",
            "FORBIDDEN_OBJECT_CELL_PHONE",
            "FORBIDDEN_OBJECT_LAPTOP",
            "FORBIDDEN_OBJECT_BOOK",
            "CLIPBOARD_ATTEMPT",
            "PRINT_SCREEN",
            "DEVTOOLS_OPEN",
            "REMOTE_CONTROL_SUSPECTED",
            # Real-time brauzer proctoring (MediaPipe) signallari
            "FACE_TURNED_AWAY",
            "EXCESSIVE_MOVEMENT",
            "HAND_GESTURE_SUSPECTED",
            "MOUTH_MOVEMENT_TALKING",
            # Yuz pozitsiyasi (masofа va markaz)
            "FACE_TOO_FAR",
            "FACE_TOO_CLOSE",
            "FACE_OFF_CENTER",
            # Liveness watchdog (server kadr kelmasligini aniqlaganda)
            "PROCTOR_FEED_LOST",
        }
    )
    if vtype not in instant_ban_types and vtype not in warn_types:
        return Response({"error": "Unknown or disallowed violation_type"}, status=400)

    try:
        exam_id_int = int(exam_id)
    except (TypeError, ValueError):
        return Response({"error": "Invalid exam_id"}, status=400)
    if not Exam.objects.filter(pk=exam_id_int).exists():
        return Response({"error": "Exam not found"}, status=404)
    if not _student_assigned_to_exam(u, exam_id_int):
        return Response({"error": "Forbidden"}, status=403)
    se_for_device = StudentExam.objects.filter(student_id=u.id, exam_id=exam_id_int).first()
    if not se_for_device or se_for_device.status != "In Progress":
        return Response({"error": "No active session"}, status=409)
    mismatch = _enforce_bound_device_or_403(se_for_device, request)
    if mismatch is not None:
        return mismatch
    sig_err = _verify_exam_hmac_or_403(se_for_device, request)
    if sig_err is not None:
        return sig_err

    def _guard(payload, status=200):
        return _exam_guarded_response(request, Response(payload, status=status))

    # Violation sababini matn sifatida qaytarish
    violation_reason_map = {
        "SUSPICIOUS_AUDIO": "Shovqin aniqlandi! Jimlik saqlang, gapirmang.",
        "FACE_NOT_VISIBLE": "Yuzingiz kamerada ko'rinmayapti! To'g'ri o'tiring va kameraga qarang.",
        "MULTIPLE_FACES": "Kadrda bir nechta shaxs aniqlandi! Boshqalar kameradan uzoqlashsin.",
        "FORBIDDEN_OBJECT_CELL_PHONE": "Telefon aniqlandi! Telefoni yashiring yoki stoldan olib qo'ying.",
        "FORBIDDEN_OBJECT_LAPTOP": "Noutbuk aniqlandi! Ruxsatsiz qurilmani olib qo'ying.",
        "FORBIDDEN_OBJECT_BOOK": "Kitob aniqlandi! Ruxsatsiz materiallarni olib qo'ying.",
        "TAB_SWITCH_SOFT": "Boshqa oynaga o'tildi! Imtihon oynasini yopmang.",
        "TAB_SWITCH_HARD": "Imtihon oynasidan chiqib ketildi! Qaytib keling.",
        "CLIPBOARD_ATTEMPT": "Nusxa ko'chirish urinishi aniqlandi!",
        "PRINT_SCREEN": "Ekran surati olish urinishi aniqlandi!",
        "DEVTOOLS_OPEN": "Developer tools ochish urinishi aniqlandi!",
        "FULLSCREEN_EXIT_HARD": "To'liq ekrandan chiqildi! Qaytib kirish uchun ekranga bosing.",
        "REMOTE_CONTROL_SUSPECTED": "Masofaviy boshqaruv aniqlandi!",
        "IDENTITY_SUBSTITUTION": "Boshqa shaxs aniqlandi! Imtihon xavfsizligi buzildi.",
        "GAZE_AWAY_LEFT": "To'g'ri qarang! Chapga emas, ekranga qarang.",
        "GAZE_AWAY_RIGHT": "To'g'ri qarang! O'ngga emas, ekranga qarang.",
        "GAZE_AWAY_UP": "To'g'ri qarang! Tepaga emas, ekranga qarang.",
        "GAZE_AWAY_DOWN": "To'g'ri qarang! Pastga emas, ekranga qarang.",
        "WHISPER_OR_CONVERSATION_SUSPECTED": "Ovoz aniqlandi! Gapirmang, jimlik saqlang.",
        "CAMERA_MIC_ACCESS_FAILED": "Kamera yoki mikrofon ishlamayapti! Ruxsat bering.",
        "VIRTUAL_WEBCAM_SUSPECTED": "Virtual kamera aniqlandi! Haqiqiy kamerani ishlating.",
        "FACE_TURNED_AWAY": "To'g'ri qarang! Yuzingizni kameradan burmang.",
        "EXCESSIVE_MOVEMENT": "Haddan tashqari qimirlash aniqlandi! Tinchoq o'tiring.",
        "HAND_GESTURE_SUSPECTED": "Qo'l ko'tarish aniqlandi! Qo'llaringizni stolda ushlab turing.",
        "MOUTH_MOVEMENT_TALKING": "Gapirish aniqlandi! Ovoz chiqarmang.",
        "FACE_TOO_FAR": "Kameradan juda uzoqsiz! Yaqinroq o'tiring.",
        "FACE_TOO_CLOSE": "Kameraga juda yaqinsiz! Biroz uzoqroq o'tiring.",
        "FACE_OFF_CENTER": "Yuzingiz kadr markazida emas! O'rtaga to'g'ri o'tiring.",
        "PROCTOR_FEED_LOST": "Kamera oqimi to'xtab qoldi! Kamera ulanishini tekshiring.",
    }
    reason_text = violation_reason_map.get(vtype, vtype)

    WARN_SUPPRESS_SECONDS = max(5, int(os.environ.get("PROCTOR_WARN_SUPPRESS_SECONDS", "10")))
    EVENT_MIN_INTERVAL_SECONDS = max(1, int(os.environ.get("PROCTOR_EVENT_MIN_INTERVAL_SECONDS", "5")))
    # Imtihon startida texnik tebranishlar (kamera/GPU) uchun grace — yozuvsiz.
    STARTUP_GRACE_SECONDS = max(0, int(os.environ.get("PROCTOR_STARTUP_GRACE_SECONDS", "0")))
    MAX_WARNINGS_BEFORE_BAN = 3  # 3-chi rasmiy ogohlantirishda darhol ban
    HARDENED_MODE = str(os.environ.get("PROCTOR_HARDENED_MODE", "1")).strip() not in ("0", "false", "False")
    HARDENED_WINDOW_MIN = max(3, int(os.environ.get("PROCTOR_HARD_WINDOW_MIN", "10")))
    HARDENED_MAX_POINTS = max(8, int(os.environ.get("PROCTOR_HARD_MAX_POINTS", "22")))
    # Boshida turli turlar ketma-ket tushganda (rolling score) haddan tashqari xavf — vaqtincha o‘chirish.
    HARDENED_STARTUP_GRACE = max(0, int(os.environ.get("PROCTOR_HARDENED_STARTUP_GRACE_SECONDS", "60")))
    GLOBAL_ACCOUNT_BAN = str(os.environ.get("VAC_GLOBAL_ACCOUNT_BAN", "0")).strip().lower() in ("1", "true", "yes")
    AUTO_BAN_NON_IDENTITY = str(os.environ.get("PROCTOR_AUTO_BAN_NON_IDENTITY", "1")).strip().lower() in (
        "1",
        "true",
        "yes",
    )
    AUTO_BAN_IDENTITY = str(os.environ.get("PROCTOR_AUTO_BAN_IDENTITY", "1")).strip().lower() in (
        "1",
        "true",
        "yes",
    )
    HARDENED_COMBO_TYPES = frozenset({"MULTIPLE_FACES", "WHISPER_OR_CONVERSATION_SUSPECTED"})

    try:
        with transaction.atomic():
            se = (
                StudentExam.objects.select_for_update()
                .filter(student_id=u.id, exam_id=exam_id_int)
                .first()
            )
            if se is None or se.status != "In Progress":
                return _guard({"error": "No active session"}, status=409)

            now = dj_tz.now()
            logs_qs = ViolationLog.objects.filter(student_id=u.id, exam_id=exam_id_int)
            # Oldingi urinish/sessiya yozuvlari yangi urinishga aralashmasin.
            if se.started_at:
                logs_qs = logs_qs.filter(timestamp__gte=se.started_at)
            if se.started_at and (now - se.started_at) < timedelta(seconds=STARTUP_GRACE_SECONDS):
                return _guard(
                    {
                        "banned": False,
                        "warningSuppressed": True,
                        "startupGrace": True,
                        "violationsCount": logs_qs.count(),
                        "warningNumber": 0,
                        "violationReason": f"Startup grace ({STARTUP_GRACE_SECONDS}s): {reason_text}",
                        "isFinalWarning": False,
                        "officialWarnings": se.proctor_official_warnings,
                    }
                )

            bypass_dedupe = (HARDENED_MODE and vtype in HARDENED_COMBO_TYPES) or vtype in instant_ban_types

            # Bir xil turdagi signal juda qisqa intervalda takrorlansa, log spam bo'lmasin.
            if not bypass_dedupe:
                if logs_qs.filter(
                    violation_type=vtype,
                    timestamp__gte=now - timedelta(seconds=EVENT_MIN_INTERVAL_SECONDS),
                ).exists():
                    return _guard(
                        {
                            "banned": False,
                            "warningSuppressed": True,
                            "violationsCount": logs_qs.count(),
                            "warningNumber": 0,
                            "violationReason": reason_text,
                            "isFinalWarning": False,
                            "officialWarnings": se.proctor_official_warnings,
                            "mergeWindowSeconds": EVENT_MIN_INTERVAL_SECONDS,
                        }
                    )

            # Rasmiy ogohlantirish merge oynasida bo'lsa, qo'shimcha log yozmaymiz.
            last = se.proctor_last_warning_at
            if not bypass_dedupe:
                if last is not None and (now - last) < timedelta(seconds=WARN_SUPPRESS_SECONDS):
                    return _guard(
                        {
                            "banned": False,
                            "warningSuppressed": True,
                            "violationsCount": logs_qs.count(),
                            "warningNumber": 0,
                            "violationReason": reason_text,
                            "isFinalWarning": False,
                            "officialWarnings": se.proctor_official_warnings,
                            "mergeWindowSeconds": WARN_SUPPRESS_SECONDS,
                        }
                    )

            ViolationLog.objects.create(
                student_id=u.id,
                exam_id=exam_id_int,
                violation_type=vtype,
                timestamp=now,
                screenshot_url=screenshot,
            )

            cnt_all = logs_qs.count()

            hardened_in_startup_window = bool(
                se.started_at
                and (now - se.started_at) < timedelta(seconds=HARDENED_STARTUP_GRACE)
            )
            if HARDENED_MODE and not hardened_in_startup_window:
                win_from = now - timedelta(minutes=HARDENED_WINDOW_MIN)
                if se.started_at and se.started_at > win_from:
                    win_from = se.started_at
                recent = list(
                    logs_qs.filter(timestamp__gte=win_from).values(
                        "violation_type", "timestamp"
                    )
                )
                hard_points = 0
                seen_types = set()
                for rr in recent:
                    tp = str(rr.get("violation_type") or "")
                    seen_types.add(tp)
                    hard_points += _priority_weight(_violation_priority(tp))

                # Real hayot: F12 + clipboard yoki tab+fullscreen bir vaqtda — alohida "combo" ban emas (ogohlantirish oqimi).
                combo_ban = "MULTIPLE_FACES" in seen_types and "WHISPER_OR_CONVERSATION_SUSPECTED" in seen_types
                if combo_ban or hard_points >= HARDENED_MAX_POINTS:
                    if not AUTO_BAN_NON_IDENTITY:
                        se.proctor_last_warning_at = now
                        if int(se.proctor_official_warnings or 0) < MAX_WARNINGS_BEFORE_BAN:
                            se.proctor_official_warnings = MAX_WARNINGS_BEFORE_BAN
                        se.save(update_fields=["proctor_official_warnings", "proctor_last_warning_at"])
                        return _guard(
                            {
                                "banned": False,
                                "requiresHumanReview": True,
                                "reviewReason": "HARDENED_RISK",
                                "violationsCount": cnt_all,
                                "warningNumber": MAX_WARNINGS_BEFORE_BAN,
                                "violationReason": f"{reason_text} (hardened)",
                                "isFinalWarning": True,
                                "warningSuppressed": False,
                                "officialWarnings": int(se.proctor_official_warnings or 0),
                                "hardenedRiskPoints": hard_points,
                                "hardenedCombo": combo_ban,
                            }
                        )
                    if GLOBAL_ACCOUNT_BAN:
                        AppUser.objects.filter(pk=u.id).update(status="Banned")
                    se.status = "Banned"
                    se.save(update_fields=["status"])
                    _notify_banned(
                        str(u.id), getattr(u, "name", str(u.id)), se.id,
                        exam_id_int, f"{reason_text} (hardened)", cnt_all,
                    )
                    return _guard(
                        {
                            "banned": True,
                            "violationsCount": cnt_all,
                            "warningNumber": MAX_WARNINGS_BEFORE_BAN,
                            "violationReason": f"{reason_text} (hardened)",
                            "isFinalWarning": False,
                            "warningSuppressed": False,
                            "officialWarnings": se.proctor_official_warnings,
                            "hardenedRiskPoints": hard_points,
                            "hardenedCombo": combo_ban,
                        }
                    )

            if vtype in instant_ban_types:
                if not AUTO_BAN_IDENTITY:
                    se.proctor_last_warning_at = now
                    if int(se.proctor_official_warnings or 0) < MAX_WARNINGS_BEFORE_BAN:
                        se.proctor_official_warnings = MAX_WARNINGS_BEFORE_BAN
                    se.save(update_fields=["proctor_official_warnings", "proctor_last_warning_at"])
                    return _guard(
                        {
                            "banned": False,
                            "requiresHumanReview": True,
                            "reviewReason": "IDENTITY_RISK",
                            "violationsCount": cnt_all,
                            "warningNumber": MAX_WARNINGS_BEFORE_BAN,
                            "violationReason": reason_text,
                            "isFinalWarning": True,
                            "warningSuppressed": False,
                            "officialWarnings": int(se.proctor_official_warnings or 0),
                        }
                    )
                if GLOBAL_ACCOUNT_BAN:
                    AppUser.objects.filter(pk=u.id).update(status="Banned")
                StudentExam.objects.filter(pk=se.pk).update(status="Banned")
                _notify_banned(
                    str(u.id), getattr(u, "name", str(u.id)), se.id,
                    exam_id_int, reason_text, cnt_all,
                )
                return _guard(
                    {
                        "banned": True,
                        "violationsCount": cnt_all,
                        "warningNumber": MAX_WARNINGS_BEFORE_BAN,
                        "violationReason": reason_text,
                        "isFinalWarning": False,
                        "warningSuppressed": False,
                        "officialWarnings": se.proctor_official_warnings,
                    }
                )

            se.proctor_official_warnings = int(se.proctor_official_warnings or 0) + 1
            se.proctor_last_warning_at = now

            if se.proctor_official_warnings >= MAX_WARNINGS_BEFORE_BAN:
                if not AUTO_BAN_NON_IDENTITY:
                    se.proctor_official_warnings = MAX_WARNINGS_BEFORE_BAN
                    se.save(update_fields=["proctor_official_warnings", "proctor_last_warning_at"])
                    return _guard(
                        {
                            "banned": False,
                            "requiresHumanReview": True,
                            "reviewReason": "WARNINGS_LIMIT",
                            "violationsCount": cnt_all,
                            "warningNumber": MAX_WARNINGS_BEFORE_BAN,
                            "violationReason": reason_text,
                            "isFinalWarning": True,
                            "warningSuppressed": False,
                            "officialWarnings": MAX_WARNINGS_BEFORE_BAN,
                        }
                    )
                if GLOBAL_ACCOUNT_BAN:
                    AppUser.objects.filter(pk=u.id).update(status="Banned")
                se.status = "Banned"
                se.save(update_fields=["proctor_official_warnings", "proctor_last_warning_at", "status"])
                _notify_banned(
                    str(u.id), getattr(u, "name", str(u.id)), se.id,
                    exam_id_int, reason_text, cnt_all,
                )
                return _guard(
                    {
                        "banned": True,
                        "violationsCount": cnt_all,
                        "warningNumber": MAX_WARNINGS_BEFORE_BAN,
                        "violationReason": reason_text,
                        "isFinalWarning": False,
                        "warningSuppressed": False,
                        "officialWarnings": se.proctor_official_warnings,
                    }
                )

            se.save(update_fields=["proctor_official_warnings", "proctor_last_warning_at"])
            cnt_warn = se.proctor_official_warnings
            # 3-chi ogohlantirishda darhol ban bo'lganligi uchun, 2-chi "oxirgi ogohlantirish"
            is_final = cnt_warn >= MAX_WARNINGS_BEFORE_BAN - 1
            return _guard(
                {
                    "banned": False,
                    "warningSuppressed": False,
                    "violationsCount": cnt_all,
                    "warningNumber": cnt_warn,
                    "violationReason": reason_text,
                    "isFinalWarning": is_final,
                    "officialWarnings": cnt_warn,
                }
            )
    except Exception:
        logger.exception(
            "student_violations: saqlashda xato exam_id=%s vtype=%s student_id=%s",
            exam_id_int,
            vtype,
            getattr(u, "id", None),
        )
        return _guard(
            {
                "error": "Could not record violation",
                "code": "VIOLATION_PERSIST_FAILED",
            },
            status=500,
        )


# ---------------------------------------------------------------------------
# Server-side proktor kadr tahlili (Browser AI o'rniga)
# ---------------------------------------------------------------------------
def _proctor_result_payload(data: dict | None) -> dict:
    data = data or {}
    return {
        "status": "done",
        "violations": list(data.get("violations") or []),
        "face_count": int(data.get("face_count") or 0),
        "skipped": bool(data.get("skipped")),
        "method": data.get("method"),
        "code": data.get("code"),
    }


@api_view(["POST"])
@throttle_classes([ProctorFrameThrottle])
@permission_classes([IsAuthenticated])
def student_proctor_frame(request, pk: int):
    """
    Server-side AI kadr tahlili — Celery worker'da bajariladi.

    Eager rejim (broker yo'q) yoki natija darhol tayyor bo'lsa: 200 + violations
    (eski sync xulq, frontend o'zgartirishsiz ishlaydi).
    Async (worker bor): 202 + {task_id} — client GET .../proctor-frame/{task_id} bilan poll qiladi.
    Client violations'ni /api/student/violations orqali yuboradi.
    """
    u = request.user
    if not _is_student_user(u):
        return Response({"error": "Forbidden"}, status=403)

    se = StudentExam.objects.filter(student_id=u.id, exam_id=pk).first()
    if not se or se.status != "In Progress":
        return Response({"error": "No active session"}, status=409)

    mismatch = _enforce_bound_device_or_403(se, request)
    if mismatch is not None:
        return mismatch

    # Liveness watchdog: oxirgi kadr kelgan vaqtni belgilaymiz (clock staleness uchun).
    StudentExam.objects.filter(pk=se.pk).update(proctor_last_frame_at=dj_tz.now())

    d = request.data or {}
    frame_b64 = str(d.get("frame") or "").strip()
    if not frame_b64:
        return Response({"error": "frame required"}, status=400)
    if len(frame_b64) > 2_000_000:
        return Response({"error": "frame too large (max ~1.5 MB base64)"}, status=413)

    enrich_objects = str(os.environ.get("PROCTOR_OPENAI_OBJECTS", "0")).strip().lower() in ("1", "true", "yes")

    try:
        task = analyze_proctor_frame_task.delay(frame_b64, enrich_objects)
    except Exception:
        logger.exception("proctor_frame enqueue failed")
        return Response({"status": "done", "violations": [], "skipped": True, "code": "QUEUE_UNAVAILABLE"}, status=200)

    if task.ready():
        # Eager yoki natija darhol tayyor — sync javob (eski xulq).
        try:
            return Response(_proctor_result_payload(task.result))
        except Exception:
            return Response({"status": "done", "violations": [], "skipped": True, "code": "TASK_FAILED"}, status=200)

    return Response({"status": "queued", "task_id": task.id, "poll_after_ms": 1500}, status=202)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def student_proctor_frame_result(request, pk: int, task_id: str):
    """Async proctor task natijasini olish (poll). Tayyor bo'lmasa 202."""
    u = request.user
    if not _is_student_user(u):
        return Response({"error": "Forbidden"}, status=403)

    from celery.result import AsyncResult

    from exam_platform.celery import app as celery_app

    res = AsyncResult(str(task_id), app=celery_app)
    if not res.ready():
        return Response({"status": "pending"}, status=202)
    if res.failed():
        return Response({"status": "done", "violations": [], "skipped": True, "code": "TASK_FAILED"}, status=200)
    try:
        return Response(_proctor_result_payload(res.result))
    except Exception:
        return Response({"status": "done", "violations": [], "skipped": True, "code": "TASK_FAILED"}, status=200)
