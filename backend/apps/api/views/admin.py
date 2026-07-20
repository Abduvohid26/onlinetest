"""Admin boshqaruvi: userlar, guruhlar, test bazasi, imtihonlar, ban-appeals."""
from __future__ import annotations

from apps.api.views._helpers import *  # noqa: F401,F403

from apps.api.views.student import _notify_student_unblocked


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def admin_users(request):
    if request.user.role != "admin":
        return Response({"error": "Forbidden"}, status=403)
    if request.method == "GET":
        qs = AppUser.objects.select_related("group").all()
        gid = request.query_params.get("group_id")
        if gid not in (None, ""):
            try:
                qs = qs.filter(group_id=int(gid))
            except (TypeError, ValueError):
                pass
        role_f = request.query_params.get("role")
        if role_f:
            qs = qs.filter(role=role_f)
        status_f = request.query_params.get("status")
        if status_f:
            qs = qs.filter(status=status_f)
        qs = qs.order_by("name")
        total = qs.count()
        try:
            limit = int(request.query_params.get("limit", 200))
        except (TypeError, ValueError):
            limit = 200
        limit = max(1, min(limit, 500))
        try:
            offset = int(request.query_params.get("offset", 0))
        except (TypeError, ValueError):
            offset = 0
        offset = max(0, offset)
        rows = []
        for u in qs[offset : offset + limit]:
            rows.append(
                {
                    "id": u.id,
                    "role": u.role,
                    "name": u.name,
                    "status": u.status,
                    "group_id": u.group_id,
                    "has_photo": bool(u.profile_image and len(u.profile_image) > 50),
                    "profile_image": None,
                    "group_name": u.group.name if u.group_id else None,
                }
            )
        resp = Response({"results": rows, "total": total, "limit": limit, "offset": offset})
        resp["X-Total-Count"] = str(total)
        return resp
    d = request.data or {}
    uid, password, role, name = d.get("id"), d.get("password"), d.get("role"), d.get("name")
    group_id = d.get("group_id")
    profile_image = d.get("profile_image")
    if not uid or not password or not role or not name:
        return Response({"error": "Missing required fields"}, status=400)
    if len(str(password)) < MIN_APP_PASSWORD_LEN:
        return Response(
            {"error": f"Parol kamida {MIN_APP_PASSWORD_LEN} belgi bo‘lishi kerak"},
            status=400,
        )
    if role not in ("admin", "student", "staff"):
        return Response({"error": "Role must be admin, student, or staff"}, status=400)
    if role == "student" and (not profile_image or len(str(profile_image)) < 50):
        return Response({"error": "Talaba uchun profil rasmi majburiy"}, status=400)
    if profile_image:
        img_err = validate_profile_image_b64(profile_image)
        if img_err:
            return Response({"error": img_err}, status=400)
    if AppUser.objects.filter(pk=uid).exists():
        return Response({"error": "User ID already exists"}, status=400)
    gid = None if group_id in ("", None) else group_id
    AppUser.objects.create(
        id=uid,
        password=_hash_pw(str(password)),
        role=role,
        name=name,
        group_id=gid,
        profile_image=profile_image or "",
    )
    audit(request, "create_user", "user", uid, name, f"role={role}")
    return Response({"success": True})
@api_view(["GET", "PATCH", "DELETE"])
@permission_classes([IsAuthenticated])
def admin_user_detail(request, user_id: str):
    if request.user.role != "admin":
        return Response({"error": "Forbidden"}, status=403)
    if request.method == "GET":
        row = AppUser.objects.filter(pk=user_id).first()
        if not row:
            return Response({"error": "User not found"}, status=404)
        has_photo = bool(row.profile_image and len(row.profile_image) > 50)
        return Response(
            {
                "id": row.id,
                "role": row.role,
                "name": row.name,
                "status": row.status,
                "group_id": row.group_id,
                "has_photo": has_photo,
                "profile_image": row.profile_image if has_photo else None,
            }
        )
    if request.method == "DELETE":
        if user_id == request.user.id:
            return Response({"error": "Cannot delete your own account"}, status=400)
        row = AppUser.objects.filter(pk=user_id).first()
        if not row:
            return Response({"error": "User not found"}, status=404)
        if row.role == "admin" and AppUser.objects.filter(role="admin").count() <= 1:
            return Response({"error": "Cannot delete the last admin"}, status=400)
        audit(request, "delete_user", "user", row.id, row.name, f"role={row.role}")
        row.delete()
        return Response({"success": True})
    row = AppUser.objects.filter(pk=user_id).first()
    if not row:
        return Response({"error": "User not found"}, status=404)
    d = request.data or {}
    next_role = d["role"] if "role" in d else row.role
    next_profile = d["profile_image"] if "profile_image" in d else row.profile_image
    if "role" in d and d["role"] not in ("admin", "student", "staff"):
        return Response({"error": "Invalid role"}, status=400)
    if row.role == "admin" and next_role in ("student", "staff"):
        if AppUser.objects.filter(role="admin").count() <= 1:
            return Response({"error": "Cannot demote the last admin"}, status=400)
    if next_role == "student" and (not next_profile or len(str(next_profile)) < 50):
        return Response({"error": "Student requires a profile photo"}, status=400)
    if "status" in d and d["status"] not in ("Active", "Banned"):
        return Response({"error": "Invalid status"}, status=400)
    if "name" in d:
        row.name = str(d["name"])
    if "role" in d:
        row.role = next_role
    if "group_id" in d:
        v = d["group_id"]
        row.group_id = None if v in ("", None) else v
    if "status" in d:
        row.status = d["status"]
    if "profile_image" in d:
        img_err = validate_profile_image_b64(d["profile_image"])
        if img_err:
            return Response({"error": img_err}, status=400)
        row.profile_image = d["profile_image"] or ""
    if d.get("password"):
        if len(str(d["password"])) < MIN_APP_PASSWORD_LEN:
            return Response(
                {"error": f"Password min {MIN_APP_PASSWORD_LEN} characters"},
                status=400,
            )
        row.password = _hash_pw(str(d["password"]))
    touched = any(
        k in d for k in ("name", "role", "group_id", "status", "profile_image", "password")
    )
    if not touched:
        return Response({"error": "No fields to update"}, status=400)
    changed = [k for k in ("name", "role", "group_id", "status", "profile_image", "password") if k in d]
    row.save()
    detail = "changed: " + ", ".join(changed)
    audit(request, "update_user", "user", row.id, row.name, detail)
    return Response({"success": True})
@api_view(["POST"])
@permission_classes([IsAuthenticated])
def admin_users_unban(request, user_id: str):
    if request.user.role != "admin":
        return Response({"error": "Forbidden"}, status=403)
    row = AppUser.objects.filter(pk=user_id).first()
    if not row:
        return Response({"error": "User not found"}, status=404)
    reason = str((request.data or {}).get("reason") or "").strip()
    if len(reason) < 8:
        return Response({"error": "Unban reason is required (min 8 chars)"}, status=400)
    ev = request.FILES.get("evidence")
    if not ev:
        return Response({"error": "JPG yoki PDF evidence fayli majburiy"}, status=400)
    mime = (getattr(ev, "content_type", "") or "").lower()
    ok_mime = mime in ("application/pdf", "image/jpeg")
    if not ok_mime:
        return Response({"error": "Faqat JPG yoki PDF qabul qilinadi"}, status=400)
    raw = ev.read()
    if not raw or len(raw) > 5 * 1024 * 1024:
        return Response({"error": "Evidence fayl hajmi 5MB dan oshmasin"}, status=400)
    ext = os.path.splitext(getattr(ev, "name", "") or "")[1].lower()
    if mime == "application/pdf" and ext != ".pdf":
        return Response({"error": "PDF fayl yuklang"}, status=400)
    if mime == "image/jpeg" and ext not in (".jpg", ".jpeg"):
        return Response({"error": "JPG fayl yuklang"}, status=400)
    with transaction.atomic():
        AppUser.objects.filter(pk=user_id).update(status="Active")
        StudentExam.objects.filter(student_id=user_id, status="Banned").update(
            status="Pending",
            ban_reason="",
            proctor_official_warnings=0,
            proctor_last_warning_at=None,
            device_fingerprint="",
            device_bound_at=None,
            session_signing_key="",
            session_request_seq=1,
        )
        UnbanEvidence.objects.create(
            student_id=user_id,
            admin_id=request.user.id,
            reason=reason[:5000],
            file_name=os.path.basename(getattr(ev, "name", "") or "evidence.bin")[:255],
            file_mime=mime,
            file_base64=base64.b64encode(raw).decode("ascii"),
        )
    audit(request, "unban_user", "user", user_id, row.name, f"reason={reason[:100]}")
    return Response({"success": True})
@api_view(["POST"])
@permission_classes([IsAuthenticated])
def admin_student_exams_retake(request, pk: int):
    u = request.user
    if u.role not in ("admin", "staff"):
        return Response({"error": "Forbidden"}, status=403)
    se_obj = StudentExam.objects.select_related("student", "exam").filter(pk=pk).first()
    if not se_obj:
        return Response({"error": "Not found"}, status=404)
    if not _staff_can_manage_student_exam(u, se_obj):
        return Response({"error": "Forbidden"}, status=403)

    from apps.api.proctor_admin_retake import apply_admin_granted_retake

    payload = apply_admin_granted_retake(
        se_obj,
        se_obj.exam,
        bonus_retakes=0,
        reset_usage=True,
        reset_session=True,
        notify_reason="Administrator qayta topshirishga ruxsat berdi",
    )
    audit(
        request,
        "retake_exam",
        "student_exam",
        pk,
        getattr(se_obj.student, "name", str(pk)),
        f"exam={getattr(se_obj.exam, 'title', '')}",
    )
    return Response(payload)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def admin_student_exams_unblock(request, pk: int):
    """Admin/staff talabani blokdan chiqaradi: topshira oladi yoki olmaydi."""
    u = request.user
    if u.role not in ("admin", "staff"):
        return Response({"error": "Forbidden"}, status=403)

    se = StudentExam.objects.select_related("student").filter(pk=pk).first()
    if not se:
        return Response({"error": "Not found"}, status=404)

    # Staff faqat o'z imtihonini unblock qila oladi
    if u.role == "staff":
        if not Exam.objects.filter(pk=se.exam_id, teacher_id=u.id).exists():
            return Response({"error": "Forbidden"}, status=403)

    can_retake = bool(request.data.get("can_retake", True))
    exam_id = se.exam_id
    student_id = str(se.student_id)
    student_name = getattr(se.student, "name", student_id)

    if can_retake:
        StudentExam.objects.filter(pk=pk).update(
            status="In Progress",
            proctor_official_warnings=0,
            proctor_last_warning_at=None,
        )

    _notify_student_unblocked(
        student_id,
        pk,
        exam_id,
        can_retake=can_retake,
        unblocked_by=str(u.id),
    )

    audit(request, "unblock_student", "student_exam", pk, student_name,
          f"exam_id={exam_id}, can_retake={can_retake}")
    return Response({"success": True, "can_retake": can_retake, "student_name": student_name})


def _staff_can_manage_student_exam(user, se: StudentExam) -> bool:
    if user.role == "admin":
        return True
    if user.role == "staff":
        return Exam.objects.filter(pk=se.exam_id, teacher_id=user.id).exists()
    return False


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def admin_student_exams_grant_technical_retakes(request, pk: int):
    """Admin/o'qituvchi talabaga +3 texnik qayta urinish beradi."""
    u = request.user
    if u.role not in ("admin", "staff"):
        return Response({"error": "Forbidden"}, status=403)

    se = StudentExam.objects.select_related("student", "exam").filter(pk=pk).first()
    if not se:
        return Response({"error": "Not found"}, status=404)
    if not _staff_can_manage_student_exam(u, se):
        return Response({"error": "Forbidden"}, status=403)

    from apps.api.proctor_admin_retake import apply_admin_granted_retake

    reset_session = (se.status or "").strip() in ("Banned", "In Progress")
    payload = apply_admin_granted_retake(
        se,
        se.exam,
        bonus_retakes=3,
        reset_usage=False,
        reset_session=reset_session,
        notify_reason="O'qituvchi qo'shimcha qayta topshirish berdi",
    )
    student_name = getattr(se.student, "name", str(se.student_id))
    audit(
        request,
        "grant_exam_retakes",
        "student_exam",
        pk,
        student_name,
        f"exam_id={se.exam_id}, remaining={payload.get('retakes_remaining')}",
    )
    return Response(
        {
            **payload,
            "student_name": student_name,
        }
    )


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def admin_student_exams_fail(request, pk: int):
    """Admin/o'qituvchi talabani imtihondan yiqib yuboradi (qayta topshirish yo'q)."""
    u = request.user
    if u.role not in ("admin", "staff"):
        return Response({"error": "Forbidden"}, status=403)

    se = StudentExam.objects.select_related("student").filter(pk=pk).first()
    if not se:
        return Response({"error": "Not found"}, status=404)
    if not _staff_can_manage_student_exam(u, se):
        return Response({"error": "Forbidden"}, status=403)

    if (se.status or "").strip() == "Completed":
        return Response({"error": "Exam already completed"}, status=409)

    reason = str((request.data or {}).get("reason") or "").strip()[:500]
    se.status = "Failed"
    se.completed_at = dj_tz.now()
    se.save(update_fields=["status", "completed_at"])

    student_name = getattr(se.student, "name", str(se.student_id))
    audit(
        request,
        "fail_student_exam",
        "student_exam",
        pk,
        student_name,
        f"exam_id={se.exam_id}, reason={reason[:80]}",
    )
    return Response({"success": True, "student_name": student_name, "status": "Failed"})
@api_view(["GET"])
@permission_classes([IsAuthenticated])
def admin_ban_appeals(request):
    if request.user.role != "admin":
        return Response({"error": "Forbidden"}, status=403)
    status_f = (request.query_params.get("status") or "").strip()
    qs = BanAppeal.objects.select_related("student", "exam", "reviewed_by").order_by("-created_at")
    if status_f:
        qs = qs.filter(status=status_f)
    out = []
    for r in qs[:200]:
        out.append(
            {
                "id": r.id,
                "student_id": r.student_id,
                "student_name": r.student.name,
                "exam_id": r.exam_id,
                "exam_title": r.exam.title if r.exam_id else None,
                "status": r.status,
                "reason": r.reason,
                "review_note": r.review_note,
                "evidence_name": r.evidence_name,
                "evidence_mime": r.evidence_mime,
                "evidence_sha256": r.evidence_sha256,
                "created_at": r.created_at.isoformat() if r.created_at else None,
                "reviewed_at": r.reviewed_at.isoformat() if r.reviewed_at else None,
                "reviewed_by": r.reviewed_by_id,
            }
        )
    return Response(out)
@api_view(["POST"])
@permission_classes([IsAuthenticated])
def admin_ban_appeal_resolve(request, pk: int):
    if request.user.role != "admin":
        return Response({"error": "Forbidden"}, status=403)
    row = BanAppeal.objects.filter(pk=pk).select_related("student").first()
    if not row:
        return Response({"error": "Appeal not found"}, status=404)
    if row.status != "Pending":
        return Response({"error": "Appeal already resolved"}, status=400)
    d = request.data or {}
    decision = str(d.get("decision") or "").strip().lower()
    note = str(d.get("note") or "").strip()
    if decision not in ("approve", "reject"):
        return Response({"error": "decision must be approve/reject"}, status=400)
    if decision == "reject" and len(note) < 8:
        return Response({"error": "Reject note min 8 chars"}, status=400)

    now = dj_tz.now()
    with transaction.atomic():
        if decision == "approve":
            AppUser.objects.filter(pk=row.student_id).update(status="Active")
            banned_qs = StudentExam.objects.filter(student_id=row.student_id, status="Banned")
            if row.exam_id:
                banned_qs = banned_qs.filter(exam_id=row.exam_id)
            resumed = list(
                banned_qs.filter(started_at__isnull=False).values_list("pk", "exam_id")
            )
            banned_qs.filter(started_at__isnull=False).update(
                status="In Progress",
                proctor_official_warnings=0,
                proctor_last_warning_at=None,
            )
            banned_qs.filter(started_at__isnull=True).update(
                status="Pending",
                proctor_official_warnings=0,
                proctor_last_warning_at=None,
            )
            row.status = "Approved"
        else:
            row.status = "Rejected"
        row.review_note = note[:5000]
        row.reviewed_by_id = request.user.id
        row.reviewed_at = now
        row.save(update_fields=["status", "review_note", "reviewed_by", "reviewed_at"])
        BanAppealEvent.objects.create(
            appeal_id=row.id,
            actor_id=request.user.id,
            action="RESOLVED_APPROVE" if decision == "approve" else "RESOLVED_REJECT",
            note=note[:1000],
            meta_json=json.dumps({"status": row.status}),
        )
    if decision == "approve":
        for se_pk, ex_id in resumed:
            _notify_student_unblocked(
                row.student_id,
                se_pk,
                ex_id,
                can_retake=True,
                unblocked_by=str(request.user.id),
            )

    action_key = "approve_appeal" if decision == "approve" else "reject_appeal"
    audit(request, action_key, "appeal", row.id, row.student.name, f"decision={decision}, note={note[:80]}")
    return Response({"success": True, "status": row.status})
@api_view(["GET"])
@permission_classes([IsAuthenticated])
def admin_ban_appeal_events(request, pk: int):
    if request.user.role != "admin":
        return Response({"error": "Forbidden"}, status=403)
    if not BanAppeal.objects.filter(pk=pk).exists():
        return Response({"error": "Appeal not found"}, status=404)
    rows = BanAppealEvent.objects.filter(appeal_id=pk).order_by("created_at")
    out = []
    for e in rows:
        out.append(
            {
                "id": e.id,
                "appeal_id": e.appeal_id,
                "actor_id": e.actor_id,
                "action": e.action,
                "note": e.note,
                "meta": safe_json_loads(e.meta_json, {}),
                "created_at": e.created_at.isoformat() if e.created_at else None,
            }
        )
    return Response(out)
@api_view(["GET"])
@permission_classes([IsAuthenticated])
def admin_review_queue(request):
    if request.user.role not in ("admin", "staff"):
        return Response({"error": "Forbidden"}, status=403)
    try:
        limit = int(request.query_params.get("limit", 80))
    except (TypeError, ValueError):
        limit = 80
    limit = max(1, min(limit, 300))
    teacher_id = str(request.user.id) if request.user.role == "staff" else None
    queue = _review_queue_rows(limit=limit, teacher_id=teacher_id)
    return Response({"results": queue, "total": len(queue)})
@api_view(["GET"])
@permission_classes([IsAuthenticated])
def admin_stats(request):
    if request.user.role != "admin":
        return Response({"error": "Forbidden"}, status=403)
    return Response(
        {
            "totalUsers": AppUser.objects.count(),
            "totalExams": Exam.objects.count(),
            "totalViolations": ViolationLog.objects.count(),
            "bannedUsers": AppUser.objects.filter(status="Banned").count(),
        }
    )


# --- Admin: levels / groups ---
@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def admin_levels(request):
    if request.user.role != "admin":
        return Response({"error": "Forbidden"}, status=403)
    if request.method == "GET":
        return Response(list(Level.objects.order_by("name").values()))
    name = (request.data or {}).get("name")
    if not name or not str(name).strip():
        return Response({"error": "Name required"}, status=400)
    name = str(name).strip()[:200]
    if Level.objects.filter(name__iexact=name).exists():
        return Response({"error": "Bu nomdagi level allaqachon bor"}, status=400)
    lv = Level.objects.create(name=name)
    audit(request, "create_level", "level", lv.id, lv.name)
    return Response({"id": lv.id, "name": lv.name})


@api_view(["GET", "PATCH", "DELETE"])
@permission_classes([IsAuthenticated])
def admin_level_detail(request, pk: int):
    if request.user.role != "admin":
        return Response({"error": "Forbidden"}, status=403)
    lv = Level.objects.filter(pk=pk).first()
    if not lv:
        return Response({"error": "Level topilmadi"}, status=404)
    if request.method == "GET":
        group_count = Group.objects.filter(level_id=pk).count()
        return Response({"id": lv.id, "name": lv.name, "group_count": group_count})
    if request.method == "PATCH":
        name = (request.data or {}).get("name")
        if not name or not str(name).strip():
            return Response({"error": "Name required"}, status=400)
        old_name = lv.name
        name = str(name).strip()[:200]
        if Level.objects.filter(name__iexact=name).exclude(pk=pk).exists():
            return Response({"error": "Bu nomdagi daraja allaqachon bor"}, status=400)
        lv.name = name
        lv.save()
        audit(request, "rename_level", "level", lv.id, lv.name, f"{old_name!r} → {lv.name!r}")
        return Response({"id": lv.id, "name": lv.name})
    if request.method == "DELETE":
        group_count = Group.objects.filter(level_id=pk).count()
        if group_count > 0:
            return Response(
                {"error": f"Bu darajada {group_count} ta guruh bor. Avval guruhlarni o'chirib yuboring."},
                status=400,
            )
        audit(request, "delete_level", "level", lv.id, lv.name)
        lv.delete()
        return Response({"success": True})


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def admin_groups(request):
    if request.user.role != "admin":
        return Response({"error": "Forbidden"}, status=403)
    if request.method == "GET":
        from django.db.models import Count
        student_counts = {
            row["group_id"]: row["cnt"]
            for row in AppUser.objects.filter(role="student", group_id__isnull=False)
            .values("group_id")
            .annotate(cnt=Count("id"))
        }
        out = []
        for g in Group.objects.select_related("level").all():
            out.append(
                {
                    "id": g.id,
                    "name": g.name,
                    "level_id": g.level_id,
                    "level_name": g.level.name,
                    "program_track": getattr(g, "program_track", "bachelor") or "bachelor",
                    "academic_year": getattr(g, "academic_year", None),
                    "student_count": student_counts.get(g.id, 0),
                }
            )
        return Response(out)
    d = request.data or {}
    name, level_id = d.get("name"), d.get("level_id")
    if not name or not level_id:
        return Response({"error": "Name and level_id are required"}, status=400)
    pt = (d.get("program_track") or "bachelor").strip()[:20]
    ay = d.get("academic_year")
    ay_val = None
    if ay not in (None, "", "null"):
        try:
            ay_val = int(ay)
        except (TypeError, ValueError):
            ay_val = None
    g = Group.objects.create(name=name, level_id=level_id, program_track=pt, academic_year=ay_val)
    audit(request, "create_group", "group", g.id, g.name, f"level_id={level_id}")
    return Response({"success": True, "id": g.id})
@api_view(["PATCH", "DELETE"])
@permission_classes([IsAuthenticated])
def admin_group_detail(request, pk: int):
    if request.user.role != "admin":
        return Response({"error": "Forbidden"}, status=403)
    if request.method == "DELETE":
        force = (request.data or {}).get("force", False)
        student_count = AppUser.objects.filter(group_id=pk, role="student").count()
        if student_count > 0 and not force:
            return Response(
                {"error": f"Bu guruhda {student_count} ta talaba bor.", "student_count": student_count, "requires_force": True},
                status=409,
            )
        grp = Group.objects.filter(pk=pk).first()
        grp_name = grp.name if grp else str(pk)
        n, _ = Group.objects.filter(pk=pk).delete()
        if not n:
            return Response({"error": "Group not found"}, status=404)
        audit(request, "delete_group", "group", pk, grp_name, f"force={force}, students_moved={student_count}")
        return Response({"success": True})
    g = Group.objects.filter(pk=pk).first()
    if not g:
        return Response({"error": "Group not found"}, status=404)
    d = request.data or {}
    if "level_id" in d and d["level_id"] is not None:
        if not Level.objects.filter(pk=d["level_id"]).exists():
            return Response({"error": "Invalid level"}, status=400)
    uf = []
    if "name" in d and "level_id" in d:
        g.name, g.level_id = d["name"], d["level_id"]
        uf.extend(["name", "level_id"])
    elif "name" in d:
        g.name = d["name"]
        uf.append("name")
    elif "level_id" in d:
        g.level_id = d["level_id"]
        uf.append("level_id")
    if "program_track" in d:
        g.program_track = str(d["program_track"] or "bachelor").strip()[:20] or "bachelor"
        uf.append("program_track")
    if "academic_year" in d:
        v = d["academic_year"]
        if v in ("", None, "null"):
            g.academic_year = None
        else:
            try:
                g.academic_year = int(v)
            except (TypeError, ValueError):
                return Response({"error": "academic_year noto‘g‘ri"}, status=400)
        uf.append("academic_year")
    if not uf:
        return Response({"error": "No fields to update"}, status=400)
    g.save(update_fields=list(dict.fromkeys(uf)))
    audit(request, "update_group", "group", g.id, g.name, "changed: " + ", ".join(uf))
    return Response({"success": True})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def admin_audit_log(request):
    if request.user.role != "admin":
        return Response({"error": "Forbidden"}, status=403)

    from apps.core.models import AuditLog
    from django.utils import timezone
    import datetime, csv
    from django.http import HttpResponse

    limit = min(int(request.query_params.get("limit", 100)), 500)
    offset = int(request.query_params.get("offset", 0))
    actor = request.query_params.get("actor", "")
    action = request.query_params.get("action", "")
    period = request.query_params.get("period", "")   # today/week/month/year
    date_from = request.query_params.get("date_from", "")
    date_to = request.query_params.get("date_to", "")
    export = request.query_params.get("export", "")   # "csv"

    qs = AuditLog.objects.all()
    if actor:
        qs = qs.filter(actor_id__icontains=actor)
    if action:
        qs = qs.filter(action=action)

    now = timezone.now()
    if period == "today":
        qs = qs.filter(created_at__date=now.date())
    elif period == "week":
        qs = qs.filter(created_at__gte=now - datetime.timedelta(days=7))
    elif period == "month":
        qs = qs.filter(created_at__year=now.year, created_at__month=now.month)
    elif period == "year":
        qs = qs.filter(created_at__year=now.year)
    elif date_from:
        try:
            qs = qs.filter(created_at__date__gte=datetime.date.fromisoformat(date_from))
        except ValueError:
            pass
    if date_to:
        try:
            qs = qs.filter(created_at__date__lte=datetime.date.fromisoformat(date_to))
        except ValueError:
            pass

    if export == "csv":
        all_rows = list(qs.values(
            "id", "actor_id", "actor_name", "action",
            "target_type", "target_id", "target_name", "detail", "created_at"
        ))
        resp = HttpResponse(content_type="text/csv; charset=utf-8")
        resp["Content-Disposition"] = 'attachment; filename="audit_log.csv"'
        resp.write("﻿")  # BOM for Excel UTF-8
        w = csv.writer(resp)
        w.writerow(["ID", "Admin ID", "Admin nomi", "Amal", "Maqsad turi", "Maqsad ID", "Maqsad nomi", "Tafsilot", "Sana"])
        for r in all_rows:
            w.writerow([r["id"], r["actor_id"], r["actor_name"], r["action"],
                        r["target_type"], r["target_id"], r["target_name"],
                        r["detail"], r["created_at"].strftime("%Y-%m-%d %H:%M") if r["created_at"] else ""])
        return resp

    total = qs.count()
    rows = list(qs.values(
        "id", "actor_id", "actor_name", "action",
        "target_type", "target_id", "target_name", "detail", "created_at"
    )[offset: offset + limit])
    for row in rows:
        if row["created_at"]:
            row["created_at"] = row["created_at"].isoformat()
    return Response({"total": total, "rows": rows})


# --- Test bank ---
@api_view(["POST"])
@throttle_classes([BankAiImportThrottle])
@permission_classes([IsAuthenticated])
def admin_test_bank_import_smart(request):
    """PDF/DOCX/matn → OpenAI: MCQ (inglizcha 3–5 variant, javob kaliti) → baza + uz/ru tarjima."""
    if request.user.role != "admin":
        return Response({"error": "Forbidden"}, status=403)
    d = request.data or {}
    language = d.get("language") or "auto"
    if not isinstance(language, str) or len(language) > 10:
        language = "en"
    collection_name = (d.get("collection_name") or "").strip()[:300]
    single_cat = None
    if collection_name and language not in ("en", "uz", "ru", "auto"):
        language = "auto"
        single_cat, _ = TestBankCategory.objects.get_or_create(
            name=collection_name,
            defaults={
                "description": "",
                "sort_order": 0,
                "program_track": "any",
                "source_language": "en",
            },
        )
    target_cat_id = None if single_cat else d.get("target_category_id")
    try:
        target_cat_id = int(target_cat_id) if target_cat_id not in (None, "", "0") else None
    except (TypeError, ValueError):
        target_cat_id = None
    text = ""
    raw_doc: bytes | None = None
    safe_name = ""
    f = request.FILES.get("file")
    if f:
        raw_doc = f.read()
        safe_name = os.path.basename(getattr(f, "name", "") or "")
        try:
            text = extract_text_from_bank_upload(raw_doc, safe_name)
        except ValueError as e:
            return Response({"error": str(e)}, status=400)
    elif d.get("raw_text") is not None:
        text = str(d["raw_text"])
    text = (text or "").strip()
    if not text and not raw_doc:
        return Response({"error": "raw_text yoki file kerak"}, status=400)
    if len(text) > 400_000:
        text = text[:400_000]
    source_language = language if language in ("en", "uz", "ru") else detect_question_language(text)
    # OCR/scan hujjatlar: matn juda kam bo'lsa multimodal parserga tushiramiz.
    if raw_doc and safe_name and len(text) < 180:
        try:
            items = parse_and_classify_document_bytes(raw_doc, safe_name, source_language)
            chunks = [text] if text else ["visual"]
        except Exception:
            items = []
            chunks = []
    else:
        items = []
        chunks = []
    if not items:
        chunks = _split_large_text(text)
    # Juda katta fayllarda AI chaqiruvlari worker timeout berishi mumkin.
    force_local_parse = len(text) > 180_000 or len(chunks) >= 3
    for chunk in chunks:
        if force_local_parse:
            try:
                parsed = parse_flexible_questionnaire(chunk, source_language)
            except Exception:
                try:
                    parsed = parse_structured_questionnaire(chunk, source_language)
                except Exception:
                    parsed = []
            items.extend(parsed or [])
            continue
        try:
            parsed = parse_and_classify_questionnaire(chunk, source_language)
        except RuntimeError:
            # OpenAI vaqtincha ishlamasa ham structured fallback bilan davom etamiz.
            try:
                parsed = parse_flexible_questionnaire(chunk, source_language)
            except Exception:
                try:
                    parsed = parse_structured_questionnaire(chunk, source_language)
                except Exception:
                    parsed = []
        except ValueError:
            # AI javobi yaroqsiz bo'lsa local parserlarga tushamiz.
            try:
                parsed = parse_flexible_questionnaire(chunk, source_language)
            except Exception:
                try:
                    parsed = parse_structured_questionnaire(chunk, source_language)
                except Exception:
                    parsed = []
        except Exception:
            try:
                parsed = parse_flexible_questionnaire(chunk, source_language)
            except Exception:
                try:
                    parsed = parse_structured_questionnaire(chunk, source_language)
                except Exception:
                    parsed = []
        items.extend(parsed or [])

    if raw_doc and safe_name and len(items) < 5 and len(raw_doc) <= 20 * 1024 * 1024:
        # Kam topilsa multimodal parsing bilan to'ldirishga harakat qilamiz.
        try:
            visual_items = parse_and_classify_document_bytes(raw_doc, safe_name, source_language)
            seen = {f"{x.get('text','')}||{'|'.join(x.get('options', []))}" for x in items}
            for vi in visual_items:
                sig = f"{vi.get('text','')}||{'|'.join(vi.get('options', []))}"
                if sig not in seen:
                    items.append(vi)
                    seen.add(sig)
        except Exception:
            pass

    if not items:
        return Response(
            {
                "error": "Savollarni avtomatik ajratib bo‘lmadi. Fayl juda murakkab bo‘lsa uni 2-3 bo‘lak qilib import qiling.",
            },
            status=400,
        )

    # --- Tarjima (yangi: bitta API call da barcha tillar, chunk size=8) ---
    translations: list[dict] = []
    payload = [
        {"text": x["text"], "options": x["options"], "correctAnswer": x["correctAnswer"]}
        for x in items
    ]
    # Max 120 ta savol uchun tarjima qilamiz (timeout oldini olish)
    translate_limit = 120
    try:
        if len(payload) <= translate_limit:
            translations = translate_questions_batch(payload, source_language)
        else:
            head = translate_questions_batch(payload[:translate_limit], source_language)
            translations = head + ([{}] * max(0, len(payload) - len(head)))
    except Exception:
        translations = [{} for _ in payload]

    categories_touched: dict[str, int] = {}
    inserted = 0
    with transaction.atomic():
        fixed_cat = None
        if target_cat_id:
            fixed_cat = TestBankCategory.objects.filter(pk=target_cat_id).first()
            if not fixed_cat:
                return Response({"error": "Tanlangan kategoriya topilmadi"}, status=400)
            uf = ["source_language"]
            pt = d.get("category_program_track")
            if isinstance(pt, str) and pt.strip():
                fixed_cat.program_track = pt.strip()[:20]
                uf.append("program_track")
            ay = d.get("category_academic_year")
            if ay not in (None, "", "null"):
                try:
                    fixed_cat.academic_year = int(ay)
                    uf.append("academic_year")
                except (TypeError, ValueError):
                    pass
            fixed_cat.source_language = source_language
            fixed_cat.save(update_fields=uf)

        for idx, it in enumerate(items):
            if single_cat:
                cat = single_cat
            elif fixed_cat:
                cat = fixed_cat
            else:
                cat_name = str(
                    it.get("categoryName") or it.get("category") or collection_name or "Umumiy"
                ).strip()[:300] or "Umumiy"
                cat = _get_or_create_bank_category(cat_name, it.get("categoryDescription") or "")
                cat.source_language = source_language
                cat.save(update_fields=["source_language"])

            tr = translations[idx] if idx < len(translations) else {}

            # Manba tiliga qarab to'g'ri maydonlarni olish
            def _tr_str(key: str) -> str:
                return str(tr.get(key) or "")[:50000]

            def _tr_list(key: str) -> list:
                v = tr.get(key)
                return v if isinstance(v, list) else []

            # text: manba tilida original, qolganlar tarjima
            # DB: text (asosiy), text_uz, text_ru, options_uz_json, options_ru_json
            text_main = it["text"]
            opts_main = it["options"]
            ca_main = it["correctAnswer"]

            if source_language == "en":
                # EN asl matn, UZ/RU tarjima
                text_uz = _tr_str("text_uz")
                text_ru = _tr_str("text_ru")
                opts_uz = _tr_list("options_uz")
                opts_ru = _tr_list("options_ru")
                ca_uz = _tr_str("correct_answer_uz")
                ca_ru = _tr_str("correct_answer_ru")
            elif source_language == "ru":
                # RU asl matn → text_ru = asl, text_uz = tarjima
                text_uz = _tr_str("text_uz")
                text_ru = text_main  # asl
                opts_uz = _tr_list("options_uz")
                opts_ru = opts_main  # asl
                ca_uz = _tr_str("correct_answer_uz")
                ca_ru = ca_main  # asl
            else:
                # UZ yoki other → text_uz = asl, text_ru = tarjima
                text_uz = text_main  # asl
                text_ru = _tr_str("text_ru")
                opts_uz = opts_main  # asl
                opts_ru = _tr_list("options_ru")
                ca_uz = ca_main  # asl
                ca_ru = _tr_str("correct_answer_ru")

            TestBankQuestion.objects.create(
                category=cat,
                text=text_main,
                options_json=json.dumps(opts_main),
                correct_answer=ca_main,
                language=source_language,
                text_uz=text_uz[:50000],
                text_ru=text_ru[:50000],
                options_uz_json=json.dumps(opts_uz) if opts_uz else "[]",
                options_ru_json=json.dumps(opts_ru) if opts_ru else "[]",
                correct_answer_uz=ca_uz[:500],
                correct_answer_ru=ca_ru[:500],
            )
            inserted += 1
            categories_touched[cat.name] = categories_touched.get(cat.name, 0) + 1

    audit(request, "import_testbank", "testbank", "", collection_name or "auto", f"inserted={inserted}, cats={len(categories_touched)}")
    return Response(
        {
            "success": True,
            "inserted": inserted,
            "detected": len(items),
            "source_language": source_language,
            "categories": [{"name": k, "questions_added": v} for k, v in sorted(categories_touched.items())],
            "chunks": len(chunks),
            "translation_limited": len(payload) > translate_limit,
            "ai_skipped_for_size": force_local_parse,
            "openai_available": bool(getattr(settings, "OPENAI_API_KEY", "") or ""),
        }
    )
@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def admin_test_bank_categories(request):
    if request.user.role != "admin":
        return Response({"error": "Forbidden"}, status=403)
    if request.method == "GET":
        rows = []
        for c in TestBankCategory.objects.annotate(
            question_count=Count("testbankquestion")
        ).order_by("sort_order", "name"):
            fq = (
                TestBankQuestion.objects.filter(category_id=c.id)
                .order_by("-id")
                .only("text", "text_uz", "text_ru")
                .first()
            )
            preview = None
            if fq:
                preview = {
                    "text_en": (fq.text or "")[:280],
                    "text_uz": (fq.text_uz or "")[:280],
                    "text_ru": (fq.text_ru or "")[:280],
                }
            rows.append(
                {
                    "id": c.id,
                    "name": c.name,
                    "description": c.description,
                    "sort_order": c.sort_order,
                    "question_count": c.question_count,
                    "source_language": getattr(c, "source_language", "en"),
                    "preview": preview,
                }
            )
        return Response(rows)
    d = request.data or {}
    if not d.get("name"):
        return Response({"error": "Name required"}, status=400)
    c = TestBankCategory.objects.create(
        name=d["name"],
        description=d.get("description") or "",
        sort_order=d.get("sort_order") or 0,
    )
    audit(request, "create_category", "category", c.id, c.name)
    return Response({"id": c.id})
@api_view(["DELETE"])
@permission_classes([IsAuthenticated])
def admin_test_bank_categories_delete(request, pk: int):
    if request.user.role != "admin":
        return Response({"error": "Forbidden"}, status=403)
    cat = TestBankCategory.objects.filter(pk=pk).first()
    cat_name = cat.name if cat else str(pk)
    TestBankCategory.objects.filter(pk=pk).delete()
    audit(request, "delete_category", "category", pk, cat_name)
    return Response({"success": True})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def admin_imentor_departments(request):
    """iMentor katalog: kafedralar (1-qadam)."""
    if request.user.role != "admin":
        return Response({"error": "Forbidden"}, status=403)
    from apps.api.imentor_client import imentor_configured, imentor_published_test_count
    from apps.api.imentor_service import departments_from_catalog, question_limit_bounds

    if not imentor_configured():
        return Response(
            {
                "configured": False,
                "departments": [],
                "published_tests_total": 0,
                "error": "IMENTOR_API_KEY sozlanmagan (backend/.env yoki api.env)",
            }
        )
    try:
        departments = departments_from_catalog()
        bounds = question_limit_bounds()
        published_tests_total = imentor_published_test_count()
    except Exception as ex:
        return Response(
            {
                "configured": True,
                "departments": [],
                "published_tests_total": 0,
                "error": str(ex),
            },
            status=502,
        )
    return Response(
        {
            "configured": True,
            "departments": departments,
            "published_tests_total": published_tests_total,
            "question_limit_bounds": bounds,
        }
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def admin_imentor_department_subjects(request, department_code: str):
    """iMentor katalog: tanlangan kafedra fanlari (2-qadam)."""
    if request.user.role != "admin":
        return Response({"error": "Forbidden"}, status=403)
    from apps.api.imentor_client import imentor_configured
    from apps.api.imentor_service import question_limit_bounds, subjects_for_department

    if not imentor_configured():
        return Response(
            {
                "configured": False,
                "department": None,
                "subjects": [],
                "error": "IMENTOR_API_KEY sozlanmagan",
            }
        )
    try:
        department, subjects = subjects_for_department(department_code)
        bounds = question_limit_bounds()
    except Exception as ex:
        return Response(
            {"configured": True, "department": None, "subjects": [], "error": str(ex)},
            status=502,
        )
    if department is None:
        return Response({"error": "Kafedra topilmadi"}, status=404)
    return Response(
        {
            "configured": True,
            "department": department,
            "subjects": subjects,
            "question_limit_bounds": bounds,
        }
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def admin_imentor_subjects(request):
    """iMentor tashqi API: fanlar ro'yxati (admin imtihon yaratish uchun)."""
    if request.user.role != "admin":
        return Response({"error": "Forbidden"}, status=403)
    from apps.api.imentor_client import imentor_configured
    from apps.api.imentor_service import subjects_from_stats

    if not imentor_configured():
        return Response(
            {
                "configured": False,
                "subjects": [],
                "error": "IMENTOR_API_KEY sozlanmagan",
            }
        )
    from apps.api.imentor_service import question_limit_bounds

    try:
        subjects = subjects_from_stats()
        bounds = question_limit_bounds()
    except Exception as ex:
        return Response(
            {"configured": True, "subjects": [], "error": str(ex)},
            status=502,
        )
    return Response(
        {
            "configured": True,
            "subjects": subjects,
            "question_limit_bounds": bounds,
        }
    )


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def admin_test_bank_questions(request):
    if request.user.role != "admin":
        return Response({"error": "Forbidden"}, status=403)
    if request.method == "GET":
        cid = request.query_params.get("category_id")
        if cid:
            qs = TestBankQuestion.objects.filter(category_id=int(cid)).order_by("-id")
            return Response(
                [
                    {
                        "id": q.id,
                        "category_id": q.category_id,
                        "text": q.text,
                        "text_uz": q.text_uz,
                        "text_ru": q.text_ru,
                        "options_json": q.options_json,
                        "options_uz_json": q.options_uz_json,
                        "options_ru_json": q.options_ru_json,
                        "correct_answer": q.correct_answer,
                        "correct_answer_uz": q.correct_answer_uz,
                        "correct_answer_ru": q.correct_answer_ru,
                        "language": q.language,
                        "created_at": q.created_at.isoformat() if q.created_at else None,
                    }
                    for q in qs
                ]
            )
        qs = (
            TestBankQuestion.objects.select_related("category")
            .order_by("-id")[:500]
        )
        out = []
        for q in qs:
            out.append(
                {
                    "id": q.id,
                    "category_id": q.category_id,
                    "text": q.text,
                    "options_json": q.options_json,
                    "correct_answer": q.correct_answer,
                    "language": q.language,
                    "category_name": q.category.name,
                    "created_at": q.created_at.isoformat() if q.created_at else None,
                }
            )
        return Response(out)
    d = request.data or {}
    category_id, questions = d.get("category_id"), d.get("questions")
    language = d.get("language") or "uz"
    if not category_id or not isinstance(questions, list) or not questions:
        return Response({"error": "category_id and questions[] required"}, status=400)
    if not TestBankCategory.objects.filter(pk=category_id).exists():
        return Response({"error": "Invalid category"}, status=400)
    n = 0
    for q in questions:
        opts = [str(x) for x in (q.get("options") or [])]
        # Texnik talabga mos: 2-10 ta variant
        if len(opts) < 2:
            continue
        opts = opts[:10]
        ca = str(q.get("correctAnswer") or opts[0])
        if ca not in opts:
            ca = opts[0]
        text = str(q.get("text") or "").strip()
        if not text:
            continue
        TestBankQuestion.objects.create(
            category_id=category_id,
            text=text,
            options_json=json.dumps(opts),
            correct_answer=ca,
            language=language,
        )
        n += 1
    audit(request, "add_questions", "testbank", category_id, "", f"inserted={n}")
    return Response({"success": True, "inserted": n})


# --- Admin exams ---
@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def admin_exams(request):
    if request.user.role != "admin":
        return Response({"error": "Forbidden"}, status=403)
    if request.method == "GET":
        out = []
        for e in Exam.objects.select_related("teacher").order_by("-id"):
            out.append(_exam_row_dict(e, e.teacher.name))
        return Response(out)
    return _admin_exams_create_impl(request)
@api_view(["GET", "PATCH", "DELETE"])
@permission_classes([IsAuthenticated])
def admin_exam_detail(request, pk: int):
    if request.user.role != "admin":
        return Response({"error": "Forbidden"}, status=403)
    if request.method == "GET":
        e = Exam.objects.select_related("teacher").filter(pk=pk).first()
        if not e:
            return Response({"error": "Exam not found"}, status=404)
        gids = list(ExamGroup.objects.filter(exam_id=pk).values_list("group_id", flat=True))
        questions = safe_json_loads(e.questions_json, [])
        bank_category_ids = safe_json_loads(e.bank_category_ids, [])
        d = _exam_row_dict(e, e.teacher.name)
        d["group_ids"] = gids
        d["questions"] = questions
        d["bank_category_ids"] = bank_category_ids
        d["exceptions"] = [
            {"student_id": x.student_id, "reason": x.reason}
            for x in ExamStudentException.objects.filter(exam_id=pk)
        ]
        d["retake_windows"] = [
            {
                "id": x.id,
                "student_id": x.student_id,
                "window_start": x.window_start.isoformat(),
                "window_end": x.window_end.isoformat(),
                "note": x.note or "",
            }
            for x in ExamRetakeWindow.objects.filter(exam_id=pk).order_by("-window_start")
        ]
        return Response(d)
    if request.method == "DELETE":
        e = Exam.objects.filter(pk=pk).first()
        if not e:
            return Response({"error": "Exam not found"}, status=404)
        audit(request, "delete_exam", "exam", pk, e.title)
        e.delete()
        return Response({"success": True})
    e = Exam.objects.filter(pk=pk).first()
    if not e:
        return Response({"error": "Exam not found"}, status=404)
    d = request.data or {}
    questions_json = e.questions_json
    bank_cats_json = e.bank_category_ids or "[]"
    bank_count = e.bank_question_count or 0
    imentor_codes_json = e.imentor_subject_codes or "[]"
    lang = d.get("language", e.language)

    if e.exam_mode == "static" and d.get("questions") is not None:
        qs = d["questions"]
        if not isinstance(qs, list) or not qs:
            return Response({"error": "questions must be a non-empty array"}, status=400)
        normalized = []
        for i, q in enumerate(qs):
            opts = [str(x) for x in (q.get("options") or [])][:4]
            while len(opts) < 4:
                opts.append(f"Variant {len(opts) + 1}")
            cor = str(q.get("correctAnswer") or opts[0])
            if cor not in opts:
                cor = opts[0]
            normalized.append(
                {"id": i + 1, "text": str(q.get("text") or f"Savol {i+1}"), "options": opts, "correctAnswer": cor}
            )
        questions_json = json.dumps(normalized)

    if e.exam_mode == "bank_mixed" and (
        d.get("bank_category_ids") is not None or d.get("bank_question_count") is not None
    ):
        cat_ids = d.get("bank_category_ids")
        if cat_ids is None:
            cat_ids = safe_json_loads(e.bank_category_ids, [])
        if not isinstance(cat_ids, list) or not cat_ids:
            return Response({"error": "Select at least one test bank category"}, status=400)
        n = max(1, min(200, int(d.get("bank_question_count") or e.bank_question_count or 20)))
        need_bank = n
        ok, pool_len = _bank_pool_check(cat_ids, need_bank)
        if not ok:
            return Response(
                {"error": f"Test bazasida yetarli savol yo'q ({pool_len}/{need_bank})"},
                status=400,
            )
        bank_cats_json = json.dumps(cat_ids)
        bank_count = n

    if e.exam_mode == "imentor_mixed" and (
        d.get("imentor_subject_codes") is not None or d.get("bank_question_count") is not None
    ):
        from apps.api.imentor_client import IMentorApiError
        from apps.api.imentor_service import (
            normalize_exam_question_count,
            resolve_imentor_subject_codes,
            validate_imentor_subjects,
        )

        if d.get("imentor_subject_codes") is not None:
            raw_codes = d.get("imentor_subject_codes")
            if isinstance(raw_codes, list):
                raw_list = [str(c).strip() for c in raw_codes if str(c).strip()]
            else:
                raw_list = [
                    str(c).strip()
                    for c in safe_json_loads(raw_codes or "[]", [])
                    if str(c).strip()
                ]
            ok, err, _total = validate_imentor_subjects(raw_list)
            if not ok:
                return Response({"error": err}, status=400)
            try:
                codes = resolve_imentor_subject_codes(raw_list)
            except IMentorApiError as ex:
                return Response({"error": str(ex)}, status=400)
            imentor_codes_json = json.dumps(codes)
        if d.get("bank_question_count") is not None:
            try:
                bank_count = normalize_exam_question_count(d.get("bank_question_count"))
            except IMentorApiError as ex:
                return Response({"error": str(ex)}, status=400)

    title = d.get("title", e.title)
    st = parse_iso_datetime(d.get("start_time", e.start_time))
    et = parse_iso_datetime(d.get("end_time", e.end_time))
    dur = int(d.get("duration_minutes", e.duration_minutes))
    pin = d.get("pin", e.pin)
    rules = d.get("custom_rules", e.custom_rules or "")
    if not title or not st or not et or not dur:
        return Response({"error": "Missing required exam fields"}, status=400)

    try:
        with transaction.atomic():
            e.title = title
            e.start_time = st
            e.end_time = et
            e.duration_minutes = dur
            e.questions_json = questions_json
            e.language = lang
            e.pin = pin or ""
            e.custom_rules = rules or ""
            e.bank_category_ids = bank_cats_json
            e.bank_question_count = bank_count
            e.imentor_subject_codes = imentor_codes_json
            if d.get("technical_retakes_allowed") is not None:
                e.technical_retakes_allowed = max(
                    0, min(20, int(d.get("technical_retakes_allowed") or 0))
                )
            if d.get("proctor_profile") is not None:
                from apps.api.proctor_profiles import normalize_proctor_profile, retake_limits_for_profile

                profile = normalize_proctor_profile(d.get("proctor_profile"))
                limits = retake_limits_for_profile(profile)
                e.proctor_profile = profile
                if d.get("technical_retakes_allowed") is None:
                    e.technical_retakes_allowed = limits["technical_retakes_allowed"]
                if d.get("identity_retakes_allowed") is None:
                    e.identity_retakes_allowed = limits["identity_retakes_allowed"]
            if d.get("identity_retakes_allowed") is not None:
                e.identity_retakes_allowed = max(0, min(5, int(d.get("identity_retakes_allowed") or 0)))
            if "teacher_id" in d:
                tu = AppUser.objects.filter(pk=str(d["teacher_id"]).strip()).first()
                if tu and _request_user_role_norm(tu) in ("admin", "staff"):
                    e.teacher_id = tu.id
            e.save()
            if d.get("group_ids") is not None:
                gids = d["group_ids"]
                if not isinstance(gids, list) or not gids:
                    raise ValueError("GROUP_IDS")
                ExamGroup.objects.filter(exam_id=pk).delete()
                ExamGroup.objects.bulk_create(
                    [ExamGroup(exam_id=pk, group_id=gid) for gid in gids]
                )
    except ValueError:
        return Response({"error": "Select at least one group"}, status=400)
    audit(request, "update_exam", "exam", pk, e.title)
    return Response({"success": True})
@api_view(["GET"])
@permission_classes([IsAuthenticated])
def admin_exams_results(request, pk: int):
    if request.user.role != "admin":
        return Response({"error": "Forbidden"}, status=403)
    e = Exam.objects.filter(pk=pk).first()
    if not e:
        return Response({"error": "Exam not found"}, status=404)
    violations = _violations_with_priority(pk)
    risk_by_student = _student_risk_summary(violations)
    results = []
    for se in StudentExam.objects.filter(exam_id=pk).select_related("student"):
        risk = risk_by_student.get(
            str(se.student_id),
            {
                "violations_count": 0,
                "risk_score": 0,
                "highest_priority": "medium",
                "recommended_review": False,
            },
        )
        results.append(
            {
                "id": se.id,
                "student_id": se.student_id,
                "name": se.student.name,
                "status": se.status,
                "score": se.score,
                "started_at": se.started_at.isoformat() if se.started_at else None,
                "completed_at": se.completed_at.isoformat() if se.completed_at else None,
                "answers_json": se.answers_json,
                "flagged_questions_json": se.flagged_questions_json,
                "session_questions_json": se.session_questions_json,
                "questions_json": se.session_questions_json or e.questions_json,
                "risk_score": risk["risk_score"],
                "violations_count": risk["violations_count"],
                "highest_priority": risk["highest_priority"],
                "recommended_review": risk["recommended_review"],
                "question_risk_timeline": _question_risk_timeline(se, e),
                "identity_last_checked_at": (
                    se.identity_last_checked_at.isoformat() if se.identity_last_checked_at else None
                ),
                "identity_last_matched": se.identity_last_matched,
                "identity_last_score": se.identity_last_score,
                "identity_last_method": se.identity_last_method,
                "identity_last_code": se.identity_last_code,
                "technical_retakes_used": int(getattr(se, "technical_retakes_used", 0) or 0),
                "bonus_technical_retakes": int(getattr(se, "bonus_technical_retakes", 0) or 0),
                "identity_retakes_used": int(getattr(se, "identity_retakes_used", 0) or 0),
                "violation_retakes_remaining": max(
                    0,
                    int(getattr(e, "technical_retakes_allowed", 3) or 3)
                    + int(getattr(se, "bonus_technical_retakes", 0) or 0)
                    - int(getattr(se, "technical_retakes_used", 0) or 0),
                ),
                "technical_retakes_remaining": max(
                    0,
                    int(getattr(e, "technical_retakes_allowed", 3) or 3)
                    + int(getattr(se, "bonus_technical_retakes", 0) or 0)
                    - int(getattr(se, "technical_retakes_used", 0) or 0),
                ),
                "identity_retakes_remaining": max(
                    0,
                    int(getattr(e, "identity_retakes_allowed", 1) or 1)
                    - int(getattr(se, "identity_retakes_used", 0) or 0),
                ),
            }
        )
    review_priority_counts = {
        "critical": sum(1 for v in violations if v.get("priority") == "critical"),
        "high": sum(1 for v in violations if v.get("priority") == "high"),
        "medium": sum(1 for v in violations if v.get("priority") == "medium"),
    }
    return Response(
        {
            "results": results,
            "violations": violations,
            "review_priority_counts": review_priority_counts,
            "questions_json": e.questions_json,
            "exam_mode": e.exam_mode,
        }
    )
@api_view(["PUT"])
@permission_classes([IsAuthenticated])
def admin_exam_exceptions(request, pk: int):
    if request.user.role != "admin":
        return Response({"error": "Forbidden"}, status=403)
    if not Exam.objects.filter(pk=pk).exists():
        return Response({"error": "Exam not found"}, status=404)
    items = (request.data or {}).get("items")
    if not isinstance(items, list):
        return Response({"error": "items[] kerak"}, status=400)
    with transaction.atomic():
        ExamStudentException.objects.filter(exam_id=pk).delete()
        for item in items:
            if not isinstance(item, dict):
                continue
            sid = item.get("student_id")
            if not sid:
                continue
            reason = str(item.get("reason") or "Imtihonga kiritilmadingiz.").strip()[:8000]
            if AppUser.objects.filter(pk=sid, role="student").exists():
                ExamStudentException.objects.create(exam_id=pk, student_id=sid, reason=reason)
    return Response({"success": True})
@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def admin_exam_retake_windows(request, pk: int):
    if request.user.role != "admin":
        return Response({"error": "Forbidden"}, status=403)
    if not Exam.objects.filter(pk=pk).exists():
        return Response({"error": "Exam not found"}, status=404)
    if request.method == "GET":
        return Response(
            [
                {
                    "id": x.id,
                    "student_id": x.student_id,
                    "window_start": x.window_start.isoformat(),
                    "window_end": x.window_end.isoformat(),
                    "note": x.note or "",
                }
                for x in ExamRetakeWindow.objects.filter(exam_id=pk).order_by("-window_start")
            ]
        )
    d = request.data or {}
    sid = d.get("student_id")
    ws = parse_iso_datetime(d.get("window_start"))
    we = parse_iso_datetime(d.get("window_end"))
    if not sid or not ws or not we:
        return Response({"error": "student_id, window_start, window_end kerak"}, status=400)
    if ws >= we:
        return Response({"error": "Vaqt oralig‘i noto‘g‘ri"}, status=400)
    if not AppUser.objects.filter(pk=sid, role="student").exists():
        return Response({"error": "Talaba topilmadi"}, status=404)
    note = str(d.get("note") or "")[:2000]
    w = ExamRetakeWindow.objects.create(
        exam_id=pk, student_id=sid, window_start=ws, window_end=we, note=note
    )
    return Response({"id": w.id})
@api_view(["DELETE"])
@permission_classes([IsAuthenticated])
def admin_exam_retake_window_delete(request, pk: int, wid: int):
    if request.user.role != "admin":
        return Response({"error": "Forbidden"}, status=403)
    n, _ = ExamRetakeWindow.objects.filter(pk=wid, exam_id=pk).delete()
    if not n:
        return Response({"error": "Not found"}, status=404)
    return Response({"success": True})


# --- Student ---
