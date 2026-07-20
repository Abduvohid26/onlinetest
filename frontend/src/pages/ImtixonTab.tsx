import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { translations, Language } from '../i18n';
import { readJsonSafe, parseAdminUsersList, checkAdminAuthResponse } from '../lib/http';
import { apiUrl } from '../lib/apiUrl';
import {
  defaultExamEndLocal,
  defaultExamStartLocal,
  isValidDatetimeLocal,
  toDatetimeLocalValue,
} from '../lib/datetimeLocal';
import { DateTimeField } from '../components/DateTimeField';
import { GroupMultiSelect } from '../components/GroupMultiSelect';
import {
  AdminInput,
  AdminSelect,
  AdminField,
  AdminLabel,
  AdminTextarea,
  AdminBtn,
  AdminCard,
  AdminModal,
  AdminPageMessageStack,
  PlusIcon,
} from './admin/ui';

type StudentRow = { id: string; name: string; group_id: number | null };
type StaffRow = { id: string; name: string; role: string };
type ImentorDepartment = {
  code: string;
  name: string;
  sort_order?: number;
  subjects_count?: number;
};
type ImentorSubject = {
  subject_code: string;
  subject_name: string;
  department_code?: string;
  department_name?: string;
  test_count: number;
  questions_total?: number;
  variants_count?: number;
  topics_count?: number;
};

function toIsoOrNull(localValue: string): string | null {
  const d = new Date(localValue);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function ImtixonTab({
  token,
  lang,
  adminUserId,
}: {
  token: string;
  lang: Language;
  adminUserId?: string;
}) {
  const t = translations[lang];
  const h = { Authorization: `Bearer ${token}` };

  const [groups, setGroups] = useState<any[]>([]);
  const [imentorDepartments, setImentorDepartments] = useState<ImentorDepartment[]>([]);
  const [imentorSubjects, setImentorSubjects] = useState<ImentorSubject[]>([]);
  const [imentorConfigured, setImentorConfigured] = useState(true);
  const [imentorApiError, setImentorApiError] = useState('');
  const [staffUsers, setStaffUsers] = useState<StaffRow[]>([]);

  const [title, setTitle] = useState('');
  const [startLocal, setStartLocal] = useState(defaultExamStartLocal);
  const [endLocal, setEndLocal] = useState(() => defaultExamEndLocal(60));
  const [duration, setDuration] = useState(60);
  const [technicalRetakesAllowed, setTechnicalRetakesAllowed] = useState(3);
  const [proctorProfile, setProctorProfile] = useState<'soft' | 'standard' | 'strict'>('standard');
  const [language, setLanguage] = useState('auto');
  const [pin, setPin] = useState('');
  const [customRules, setCustomRules] = useState('');
  const [responsibleStaffId, setResponsibleStaffId] = useState('');
  const [selDepartment, setSelDepartment] = useState('');
  const [selSubject, setSelSubject] = useState('');
  const [imentorMaxQ, setImentorMaxQ] = useState(0);
  const [imentorQLimits, setImentorQLimits] = useState({ min: 10, max: 30 });
  const [subjectsLoading, setSubjectsLoading] = useState(false);

  const [selGroups, setSelGroups] = useState<number[]>([]);
  const [exModal, setExModal] = useState(false);
  const [poolStudents, setPoolStudents] = useState<StudentRow[]>([]);
  const [exMap, setExMap] = useState<Record<string, { on: boolean; reason: string }>>({});

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({ type: '', text: '' });

  const loadMeta = useCallback(async () => {
    const [gr, st, im] = await Promise.all([
      fetch(apiUrl('/api/admin/groups'), { headers: h }),
      fetch(apiUrl('/api/admin/users?role=staff'), { headers: h }),
      fetch(apiUrl('/api/admin/imentor/departments'), { headers: h }),
    ]);
    if (!checkAdminAuthResponse(gr) || !checkAdminAuthResponse(st) || !checkAdminAuthResponse(im)) return;
    const gj = gr.ok ? await readJsonSafe<any[]>(gr) : null;
    const sj = st.ok ? await readJsonSafe<unknown>(st) : null;
    const ij = im.ok
      ? await readJsonSafe<{
          configured?: boolean;
          departments?: ImentorDepartment[];
          published_tests_total?: number;
          error?: string;
          question_limit_bounds?: { min?: number; max?: number };
        }>(im)
      : null;
    setGroups(Array.isArray(gj) ? gj : []);
    setStaffUsers(parseAdminUsersList<StaffRow>(sj));
    setImentorConfigured(ij?.configured !== false);
    setImentorApiError(String(ij?.error || '').trim());
    setImentorDepartments(Array.isArray(ij?.departments) ? ij!.departments! : []);
    const b = ij?.question_limit_bounds;
    if (b && typeof b.min === 'number' && typeof b.max === 'number') {
      setImentorQLimits({ min: b.min, max: b.max });
    }
  }, [token]);

  const loadDepartmentSubjects = useCallback(
    async (departmentCode: string) => {
      if (!departmentCode) {
        setImentorSubjects([]);
        return;
      }
      setSubjectsLoading(true);
      try {
        const res = await fetch(
          apiUrl(`/api/admin/imentor/departments/${encodeURIComponent(departmentCode)}/subjects`),
          { headers: h },
        );
        if (!checkAdminAuthResponse(res)) return;
        const data = await readJsonSafe<{
          subjects?: ImentorSubject[];
          question_limit_bounds?: { min?: number; max?: number };
        }>(res);
        setImentorSubjects(Array.isArray(data?.subjects) ? data!.subjects! : []);
        const b = data?.question_limit_bounds;
        if (b && typeof b.min === 'number' && typeof b.max === 'number') {
          setImentorQLimits({ min: b.min, max: b.max });
        }
      } finally {
        setSubjectsLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    setSelSubject('');
    if (selDepartment) {
      loadDepartmentSubjects(selDepartment);
    } else {
      setImentorSubjects([]);
    }
  }, [selDepartment, loadDepartmentSubjects]);

  const onDepartmentChange = (code: string) => {
    setSelDepartment(code);
  };

  const subjectsWithTests = useMemo(
    () => imentorSubjects.filter((s) => (s.test_count ?? 0) > 0),
    [imentorSubjects],
  );

  const openExceptions = async () => {
    if (selGroups.length === 0) {
      setMsg({ type: 'err', text: t.examCreateSelectGroup });
      return;
    }
    setMsg({ type: '', text: '' });
    const lists = await Promise.all(
      selGroups.map(async (gid) => {
        const res = await fetch(apiUrl(`/api/admin/users?group_id=${gid}&role=student`), { headers: h });
        if (!checkAdminAuthResponse(res)) return [];
        const j = await readJsonSafe<unknown>(res);
        return parseAdminUsersList<StudentRow>(j);
      }),
    );
    const merged: StudentRow[] = [];
    const seen = new Set<string>();
    for (const row of lists.flat()) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      merged.push(row);
    }
    merged.sort((a, b) => a.name.localeCompare(b.name));
    setPoolStudents(merged);
    setExMap((prev) => {
      const next = { ...prev };
      for (const s of merged) {
        if (!next[s.id]) next[s.id] = { on: false, reason: '' };
      }
      return next;
    });
    setExModal(true);
  };

  const exceptionsPayload = useMemo(
    () =>
      Object.entries(exMap)
        .filter(([, v]) => v.on)
        .map(([student_id, v]) => ({ student_id, reason: v.reason.trim() || t.exceptionsHint })),
    [exMap, t.exceptionsHint],
  );

  const validate = (): string | null => {
    if (!title.trim()) return t.title + ' ' + t.examManualEmptyQuestion.toLowerCase();
    if (selGroups.length === 0) return t.examCreateSelectGroup;
    if (!isValidDatetimeLocal(startLocal) || !isValidDatetimeLocal(endLocal)) return t.examDateTimeRequired;
    const startIso = toIsoOrNull(startLocal);
    const endIso = toIsoOrNull(endLocal);
    if (!startIso || !endIso) return t.examInvalidDateTime;
    if (new Date(startIso).getTime() >= new Date(endIso).getTime()) return t.examStartMustBeBeforeEnd;
    const windowMin = Math.floor((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000);
    if (duration > windowMin)
      return t.examDurationExceedsWindow
        .replace('{dur}', String(duration))
        .replace('{window}', String(windowMin));
    if (!imentorConfigured) return t.imentorNotConfigured;
    if (!selDepartment) return t.imentorPickDepartment;
    if (!selSubject) return t.imentorPickSubject;
    const picked = imentorSubjects.find((s) => s.subject_code === selSubject);
    if (!picked || (picked.test_count ?? 0) < 1) return t.imentorNoSubjects;
    if (imentorMaxQ !== 0 && (imentorMaxQ < imentorQLimits.min || imentorMaxQ > imentorQLimits.max)) {
      return t.imentorQuestionLimitInvalid;
    }
    return null;
  };

  const createExam = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg({ type: '', text: '' });
    const err = validate();
    if (err) {
      setMsg({ type: 'err', text: err });
      return;
    }

    const startIso = toIsoOrNull(startLocal)!;
    const endIso = toIsoOrNull(endLocal)!;

    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        title: title.trim(),
        start_time: startIso,
        end_time: endIso,
        duration_minutes: duration,
        language,
        pin,
        custom_rules: customRules,
        group_ids: selGroups,
        exam_exceptions: exceptionsPayload,
        exam_mode: 'imentor_mixed',
        imentor_subject_codes: selSubject ? [selSubject] : [],
        bank_question_count: Math.max(0, imentorMaxQ),
        technical_retakes_allowed: Math.max(0, Math.min(20, technicalRetakesAllowed)),
        proctor_profile: proctorProfile,
      };
      if (responsibleStaffId.trim()) body.teacher_id = responsibleStaffId.trim();

      const res = await fetch(apiUrl('/api/admin/exams'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...h },
        body: JSON.stringify(body),
      });

      if (!checkAdminAuthResponse(res)) return;
      const d = await readJsonSafe<{ error?: string }>(res);
      if (!res.ok) {
        setMsg({ type: 'err', text: d?.error || t.errorGeneric });
        return;
      }

      setMsg({ type: 'ok', text: t.examCreated });
      setTitle('');
      setPin('');
      setCustomRules('');
      setResponsibleStaffId('');
      setSelDepartment('');
      setSelSubject('');
      setSelGroups([]);
      setExMap({});
      setStartLocal(defaultExamStartLocal());
      setEndLocal(defaultExamEndLocal(duration));
    } finally {
      setBusy(false);
    }
  };

  const stickyAlerts = useMemo(() => {
    const items: Array<{ type: 'ok' | 'err' | 'error' | 'success' | 'warning'; text: string; dismissible?: boolean }> = [];
    if (msg.text) {
      items.push({
        type: msg.type === 'ok' ? 'ok' : 'err',
        text: msg.text,
        dismissible: true,
      });
    }
    if (!imentorConfigured) {
      items.push({ type: 'warning', text: t.imentorNotConfigured, dismissible: true });
    } else if (imentorApiError) {
      items.push({ type: 'error', text: imentorApiError, dismissible: true });
    }
    return items;
  }, [msg, imentorConfigured, imentorApiError, t]);

  return (
    <div className="space-y-5">
      <AdminPageMessageStack
        messages={stickyAlerts}
        onDismiss={(m) => {
          if (msg.text && m.text === msg.text) setMsg({ type: '', text: '' });
        }}
      />
      <AdminCard
        icon={
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        }
        iconBg="bg-blue-600"
        title={t.addExam}
        subtitle={t.examMethodImentor}
      >
        <div className="px-5 py-5 space-y-5">
          <form onSubmit={createExam} noValidate className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_180px] gap-4">
              <AdminField label={t.title} required>
                <AdminInput value={title} onChange={(e) => setTitle(e.target.value)} required />
              </AdminField>
              <AdminField label={t.language}>
                <AdminSelect value={language} onChange={(e) => setLanguage(e.target.value)}>
                  <option value="auto">{t.langAuto}</option>
                  <option value="uz">{t.langUzbek}</option>
                  <option value="ru">{t.langRussian}</option>
                  <option value="en">{t.langEnglish}</option>
                </AdminSelect>
                {language === 'auto' && (
                  <p className="text-[12px] text-gray-400 mt-1.5">{t.examLanguageAutoHint}</p>
                )}
              </AdminField>
            </div>

            <div className="space-y-4">
              <AdminField label={t.imentorDepartmentLabel} required>
                <AdminSelect
                  value={selDepartment}
                  onChange={(e) => onDepartmentChange(e.target.value)}
                  disabled={!imentorConfigured}
                >
                  <option value="">{t.imentorPickDepartment}</option>
                  {imentorDepartments.map((d) => (
                    <option key={d.code} value={d.code}>
                      {d.name} ({d.subjects_count ?? 0}{' '}
                      {lang === 'ru' ? 'предм.' : lang === 'en' ? 'subj.' : 'fan'})
                    </option>
                  ))}
                </AdminSelect>
                <p className="text-[12px] text-gray-400 mt-1.5">{t.imentorDepartmentHint}</p>
                {imentorConfigured && imentorDepartments.length === 0 && (
                  <p className="text-[12px] text-amber-700 mt-1.5">{t.imentorNoDepartments}</p>
                )}
              </AdminField>

              {selDepartment && (
                <AdminField label={t.imentorSubjectsLabel} required>
                  <AdminSelect
                    value={selSubject}
                    onChange={(e) => setSelSubject(e.target.value)}
                    disabled={subjectsLoading || imentorSubjects.length === 0}
                  >
                    <option value="">
                      {subjectsLoading
                        ? '…'
                        : subjectsWithTests.length === 0
                          ? t.imentorNoSubjects
                          : t.imentorPickSubject}
                    </option>
                    {imentorSubjects.map((s) => {
                      const hasTests = (s.test_count ?? 0) > 0;
                      const testLabel =
                        lang === 'ru' ? 'тест' : lang === 'en' ? 'tests' : 'test';
                      return (
                        <option key={s.subject_code} value={s.subject_code} disabled={!hasTests}>
                          {s.subject_name}
                          {hasTests
                            ? ` (${s.test_count} ${testLabel})`
                            : ` — ${t.imentorSubjectNoTests}`}
                        </option>
                      );
                    })}
                  </AdminSelect>
                  <p className="text-[12px] text-gray-400 mt-1.5">{t.imentorSubjectsHint}</p>
                </AdminField>
              )}

              <AdminField label={t.imentorMaxQuestionsLabel}>
                <AdminInput
                  type="number"
                  min={0}
                  max={imentorQLimits.max}
                  value={imentorMaxQ}
                  onChange={(e) => setImentorMaxQ(Number(e.target.value))}
                  className="max-w-[180px]"
                />
                <p className="text-[12px] text-gray-400 mt-1.5">
                  {t.imentorMaxQuestionsHint
                    .replace('{min}', String(imentorQLimits.min))
                    .replace('{max}', String(imentorQLimits.max))}
                </p>
              </AdminField>
            </div>

            <AdminField label={t.examResponsibleLabel}>
              <AdminSelect value={responsibleStaffId} onChange={(e) => setResponsibleStaffId(e.target.value)}>
                <option value="">
                  {adminUserId ? `${t.examResponsibleSelf} (${adminUserId})` : t.examResponsibleSelf}
                </option>
                {staffUsers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} · {s.id}
                  </option>
                ))}
              </AdminSelect>
              {staffUsers.length === 0 && (
                <p className="text-[12px] text-amber-700 mt-1.5">{t.examNoStaffRosterHint}</p>
              )}
            </AdminField>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <AdminField label={t.startTime} required>
                <DateTimeField
                  value={startLocal}
                  onChange={(value) => {
                    setStartLocal(value);
                    if (isValidDatetimeLocal(value)) {
                      const end = new Date(value);
                      end.setMinutes(end.getMinutes() + duration);
                      setEndLocal(toDatetimeLocalValue(end));
                    }
                  }}
                  dateLabel={t.examDateLabel}
                  timeLabel={t.examTimeLabel}
                />
                <p className="text-[12px] text-gray-400 mt-1">{t.examDateTimeHint}</p>
              </AdminField>
              <AdminField label={t.endTime} required>
                <DateTimeField
                  value={endLocal}
                  onChange={setEndLocal}
                  min={startLocal || undefined}
                  dateLabel={t.examDateLabel}
                  timeLabel={t.examTimeLabel}
                />
              </AdminField>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-[160px_160px_1fr] gap-4">
              <AdminField label={`${t.duration} (min)`} required>
                <AdminInput
                  type="number"
                  min={5}
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                  required
                />
              </AdminField>
              <AdminField label={`${t.pin} (opt.)`}>
                <AdminInput value={pin} onChange={(e) => setPin(e.target.value)} placeholder="—" />
              </AdminField>
              <AdminField label={t.proctorProfileLabel}>
                <AdminSelect
                  value={proctorProfile}
                  onChange={(e) => {
                    const next = e.target.value as 'soft' | 'standard' | 'strict';
                    setProctorProfile(next);
                    const limits = { soft: 5, standard: 3, strict: 1 } as const;
                    setTechnicalRetakesAllowed(limits[next]);
                  }}
                  className="max-w-[220px]"
                >
                  <option value="soft">{t.proctorProfileSoft}</option>
                  <option value="standard">{t.proctorProfileStandard}</option>
                  <option value="strict">{t.proctorProfileStrict}</option>
                </AdminSelect>
              </AdminField>
              <AdminField label={t.technicalRetakesAllowedLabel}>
                <AdminInput
                  type="number"
                  min={0}
                  max={20}
                  value={technicalRetakesAllowed}
                  onChange={(e) => setTechnicalRetakesAllowed(Number(e.target.value))}
                  className="max-w-[180px]"
                />
                <p className="text-[12px] text-gray-400 mt-1.5">{t.technicalRetakesAllowedHint}</p>
              </AdminField>
              <AdminField label={`${t.customRules} (opt.)`}>
                <AdminTextarea value={customRules} onChange={(e) => setCustomRules(e.target.value)} />
              </AdminField>
            </div>

            <div>
              <AdminLabel required>{t.selectGroups}</AdminLabel>
              <GroupMultiSelect
                groups={groups}
                value={selGroups}
                onChange={setSelGroups}
                lang={lang}
                onRefresh={loadMeta}
              />
              <AdminBtn type="button" variant="ghost" size="sm" className="mt-2" onClick={openExceptions}>
                {t.exceptionsBtn}
                {exceptionsPayload.length > 0 ? ` (${exceptionsPayload.length})` : ''}
              </AdminBtn>
            </div>

            <div className="pt-1">
              <AdminBtn
                type="submit"
                variant="blue"
                size="lg"
                loading={busy}
                icon={<PlusIcon size={16} />}
                className="w-full sm:w-auto"
              >
                {t.createExam}
              </AdminBtn>
            </div>
          </form>
        </div>
      </AdminCard>

      <AdminModal
        open={exModal}
        onClose={() => setExModal(false)}
        title={t.exceptionsTitle}
        subtitle={t.exceptionsHint}
        scroll
      >
        {exModal && (
          <>
            <div className="space-y-2 max-h-[50vh] overflow-y-auto">
              {poolStudents.map((s) => (
                <div key={s.id} className="p-3 rounded-xl border border-gray-200 bg-gray-50/60 space-y-2">
                  <label className="flex items-center gap-2 text-[14px] font-medium text-gray-800">
                    <input
                      type="checkbox"
                      checked={exMap[s.id]?.on ?? false}
                      onChange={(e) =>
                        setExMap((p) => ({
                          ...p,
                          [s.id]: { on: e.target.checked, reason: p[s.id]?.reason || '' },
                        }))
                      }
                      className="w-4 h-4 rounded border-gray-300 accent-violet-600"
                    />
                    {s.name}
                    <span className="text-[12px] text-gray-400 font-mono">{s.id}</span>
                  </label>
                  {(exMap[s.id]?.on ?? false) && (
                    <AdminInput
                      placeholder={t.exceptionReason}
                      value={exMap[s.id]?.reason || ''}
                      onChange={(e) =>
                        setExMap((p) => ({
                          ...p,
                          [s.id]: { on: true, reason: e.target.value },
                        }))
                      }
                    />
                  )}
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-3 mt-5">
              <AdminBtn variant="ghost" onClick={() => setExModal(false)}>
                {t.cancel}
              </AdminBtn>
              <AdminBtn variant="blue" onClick={() => setExModal(false)}>
                OK
              </AdminBtn>
            </div>
          </>
        )}
      </AdminModal>
    </div>
  );
}
