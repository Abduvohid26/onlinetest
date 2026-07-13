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
  AdminAlert,
  AdminModal,
  PlusIcon,
} from './admin/ui';

type StudentRow = { id: string; name: string; group_id: number | null };
type StaffRow = { id: string; name: string; role: string };
type ImentorSubject = {
  subject_code: string;
  subject_name: string;
  test_count: number;
  questions_total?: number;
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
  const [imentorSubjects, setImentorSubjects] = useState<ImentorSubject[]>([]);
  const [imentorConfigured, setImentorConfigured] = useState(true);
  const [staffUsers, setStaffUsers] = useState<StaffRow[]>([]);

  const [title, setTitle] = useState('');
  const [startLocal, setStartLocal] = useState(defaultExamStartLocal);
  const [endLocal, setEndLocal] = useState(() => defaultExamEndLocal(60));
  const [duration, setDuration] = useState(60);
  const [language, setLanguage] = useState('auto');
  const [pin, setPin] = useState('');
  const [customRules, setCustomRules] = useState('');
  const [responsibleStaffId, setResponsibleStaffId] = useState('');
  const [selSubjects, setSelSubjects] = useState<string[]>([]);
  const [imentorMaxQ, setImentorMaxQ] = useState(0);
  const [imentorQLimits, setImentorQLimits] = useState({ min: 10, max: 30 });

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
      fetch(apiUrl('/api/admin/imentor/subjects'), { headers: h }),
    ]);
    if (!checkAdminAuthResponse(gr) || !checkAdminAuthResponse(st) || !checkAdminAuthResponse(im)) return;
    const gj = gr.ok ? await readJsonSafe<any[]>(gr) : null;
    const sj = st.ok ? await readJsonSafe<unknown>(st) : null;
    const ij = im.ok
      ? await readJsonSafe<{
          configured?: boolean;
          subjects?: ImentorSubject[];
          question_limit_bounds?: { min?: number; max?: number };
        }>(im)
      : null;
    setGroups(Array.isArray(gj) ? gj : []);
    setStaffUsers(parseAdminUsersList<StaffRow>(sj));
    setImentorConfigured(ij?.configured !== false);
    setImentorSubjects(Array.isArray(ij?.subjects) ? ij!.subjects! : []);
    const b = ij?.question_limit_bounds;
    if (b && typeof b.min === 'number' && typeof b.max === 'number') {
      setImentorQLimits({ min: b.min, max: b.max });
    }
  }, [token]);

  useEffect(() => {
    loadMeta();
  }, [loadMeta]);

  const toggleSubject = (code: string) =>
    setSelSubjects((p) => (p.includes(code) ? p.filter((x) => x !== code) : [...p, code]));

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
    if (selSubjects.length === 0) return t.imentorPickSubject;
    const pool = imentorSubjects
      .filter((s) => selSubjects.includes(s.subject_code))
      .reduce((acc, s) => acc + Math.max(0, Number(s.test_count) || 0), 0);
    if (pool < 1) return t.imentorNoSubjects;
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
        imentor_subject_codes: selSubjects,
        bank_question_count: Math.max(0, imentorMaxQ),
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
      setSelSubjects([]);
      setSelGroups([]);
      setExMap({});
      setStartLocal(defaultExamStartLocal());
      setEndLocal(defaultExamEndLocal(duration));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
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
          {msg.text && (
            <AdminAlert type={msg.type === 'ok' ? 'success' : 'error'}>{msg.text}</AdminAlert>
          )}

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
              </AdminField>
            </div>

            <div className="space-y-3">
              <div>
                <AdminLabel required>{t.imentorSubjectsLabel}</AdminLabel>
                <p className="text-[12px] text-gray-400 mt-1 mb-3">{t.imentorSubjectsHint}</p>
                {!imentorConfigured ? (
                  <div className="p-4 text-center text-[13px] text-amber-700 bg-amber-50 rounded-2xl border border-amber-100">
                    {t.imentorNotConfigured}
                  </div>
                ) : imentorSubjects.length === 0 ? (
                  <div className="p-4 text-center text-[13px] text-amber-700 bg-amber-50 rounded-2xl border border-amber-100">
                    {t.imentorNoSubjects}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5">
                    {imentorSubjects.map((s) => {
                      const selected = selSubjects.includes(s.subject_code);
                      return (
                        <label
                          key={s.subject_code}
                          className={`flex items-start gap-3 p-3.5 rounded-2xl border cursor-pointer transition-all ${
                            selected
                              ? 'border-indigo-400 bg-indigo-50/80 ring-1 ring-indigo-200'
                              : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50/80'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => toggleSubject(s.subject_code)}
                            className="w-4 h-4 mt-0.5 rounded border-gray-300 accent-indigo-600 shrink-0"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block text-[14px] font-semibold text-gray-900 leading-snug">
                              {s.subject_name}
                            </span>
                            <span className="block text-[12px] text-gray-400 mt-0.5 truncate">{s.subject_code}</span>
                            <span className="inline-block mt-2 text-[11px] font-semibold text-indigo-700 bg-indigo-100/80 px-2 py-0.5 rounded-md">
                              {s.test_count ?? 0}{' '}
                              {lang === 'ru' ? 'тест' : lang === 'en' ? 'tests' : 'test'}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
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
