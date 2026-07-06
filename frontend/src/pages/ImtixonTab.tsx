import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { translations, Language } from '../i18n';
import { readJsonSafe, parseAdminUsersList } from '../lib/http';
import { apiUrl } from '../lib/apiUrl';
import {
  defaultExamEndLocal,
  defaultExamStartLocal,
  isValidDatetimeLocal,
  toDatetimeLocalValue,
} from '../lib/datetimeLocal';
import { DateTimeField } from '../components/DateTimeField';
import { GroupMultiSelect } from '../components/GroupMultiSelect';
import { AdminExamsTab } from './AdminExamsTab';
import {
  AdminInput,
  AdminSelect,
  AdminField,
  AdminLabel,
  AdminTextarea,
  AdminFileInput,
  AdminBtn,
  AdminCard,
  AdminAlert,
  AdminModal,
  PlusIcon,
} from './admin/ui';

type StudentRow = { id: string; name: string; group_id: number | null };
type StaffRow = { id: string; name: string; role: string };
type ManualQuestion = { text: string; options: string[]; correctAnswer: string };
type ExamMethod = 'bank' | 'pdf' | 'manual';

const METHOD_ICONS: Record<ExamMethod, React.ReactNode> = {
  bank: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
    </svg>
  ),
  pdf: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
    </svg>
  ),
  manual: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
    </svg>
  ),
};

function toIsoOrNull(localValue: string): string | null {
  const d = new Date(localValue);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function emptyQuestion(): ManualQuestion {
  return { text: '', options: ['', '', '', ''], correctAnswer: '' };
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

  // ── Umumiy holat ───────────────────────────────────────────────────────────
  const [method, setMethod] = useState<ExamMethod>('bank');
  const [groups, setGroups] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [staffUsers, setStaffUsers] = useState<StaffRow[]>([]);

  // ── Forma maydoni ──────────────────────────────────────────────────────────
  const [title, setTitle] = useState('');
  const [startLocal, setStartLocal] = useState(defaultExamStartLocal);
  const [endLocal, setEndLocal] = useState(() => defaultExamEndLocal(60));
  const [duration, setDuration] = useState(60);
  const [language, setLanguage] = useState('auto');
  const [pin, setPin] = useState('');
  const [customRules, setCustomRules] = useState('');
  const [responsibleStaffId, setResponsibleStaffId] = useState('');

  // ── Bank rejimi ────────────────────────────────────────────────────────────
  const [bankCount, setBankCount] = useState(20);
  const [selCats, setSelCats] = useState<number[]>([]);

  // ── PDF rejimi ─────────────────────────────────────────────────────────────
  const [pdfFile, setPdfFile] = useState<File | null>(null);

  // ── Manual rejimi ──────────────────────────────────────────────────────────
  const [manualQuestions, setManualQuestions] = useState<ManualQuestion[]>([emptyQuestion()]);

  // ── Guruhlar va istisnolar ─────────────────────────────────────────────────
  const [selGroups, setSelGroups] = useState<number[]>([]);
  const [exModal, setExModal] = useState(false);
  const [poolStudents, setPoolStudents] = useState<StudentRow[]>([]);
  const [exMap, setExMap] = useState<Record<string, { on: boolean; reason: string }>>({});

  // ── UI holati ──────────────────────────────────────────────────────────────
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({ type: '', text: '' });
  const [examKey, setExamKey] = useState(0);

  // ── Meta yuklash ───────────────────────────────────────────────────────────
  const loadMeta = useCallback(async () => {
    const [gr, cr, st] = await Promise.all([
      fetch(apiUrl('/api/admin/groups'), { headers: h }),
      fetch(apiUrl('/api/admin/test-bank/categories'), { headers: h }),
      fetch(apiUrl('/api/admin/users?role=staff'), { headers: h }),
    ]);
    const gj = gr.ok ? await readJsonSafe<any[]>(gr) : null;
    const cj = cr.ok ? await readJsonSafe<any[]>(cr) : null;
    const sj = st.ok ? await readJsonSafe<unknown>(st) : null;
    setGroups(Array.isArray(gj) ? gj : []);
    setCategories(Array.isArray(cj) ? cj : []);
    setStaffUsers(parseAdminUsersList<StaffRow>(sj));
  }, [token]);

  useEffect(() => { loadMeta(); }, [loadMeta]);

  // ── Helpers ────────────────────────────────────────────────────────────────
  const toggleC = (id: number) =>
    setSelCats((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const updateQuestion = (i: number, patch: Partial<ManualQuestion>) =>
    setManualQuestions((qs) => qs.map((q, idx) => (idx === i ? { ...q, ...patch } : q)));

  const updateOption = (qi: number, oi: number, value: string) =>
    setManualQuestions((qs) =>
      qs.map((q, idx) => {
        if (idx !== qi) return q;
        const options = q.options.map((o, i) => (i === oi ? value : o));
        const correctAnswer = q.correctAnswer === q.options[oi] ? value : q.correctAnswer;
        return { ...q, options, correctAnswer };
      }),
    );

  const removeQuestion = (i: number) =>
    setManualQuestions((qs) => (qs.length > 1 ? qs.filter((_, idx) => idx !== i) : qs));

  // ── Istisnolar modali ──────────────────────────────────────────────────────
  const openExceptions = async () => {
    if (selGroups.length === 0) {
      setMsg({ type: 'err', text: t.examCreateSelectGroup });
      return;
    }
    setMsg({ type: '', text: '' });
    const lists = await Promise.all(
      selGroups.map(async (gid) => {
        const res = await fetch(apiUrl(`/api/admin/users?group_id=${gid}&role=student`), { headers: h });
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

  // ── Frontend validatsiya ───────────────────────────────────────────────────
  const validate = (): string | null => {
    if (!title.trim()) return t.title + ' ' + t.examManualEmptyQuestion.toLowerCase();
    if (selGroups.length === 0) return t.examCreateSelectGroup;
    if (!isValidDatetimeLocal(startLocal) || !isValidDatetimeLocal(endLocal))
      return t.examDateTimeRequired;
    const startIso = toIsoOrNull(startLocal);
    const endIso = toIsoOrNull(endLocal);
    if (!startIso || !endIso) return t.examInvalidDateTime;
    if (new Date(startIso).getTime() >= new Date(endIso).getTime())
      return t.examStartMustBeBeforeEnd;
    const windowMin = Math.floor((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000);
    if (duration > windowMin)
      return t.examDurationExceedsWindow
        .replace('{dur}', String(duration))
        .replace('{window}', String(windowMin));

    if (method === 'bank') {
      if (selCats.length === 0) return t.testBankPickCategory;
      const poolCount = categories
        .filter((c: any) => selCats.includes(c.id))
        .reduce((s: number, c: any) => s + Math.max(0, Number(c.question_count) || 0), 0);
      if (poolCount < 1) return t.examCreateBankCategoriesEmpty;
    }
    if (method === 'pdf' && !pdfFile) return t.uploadPdf;
    if (method === 'manual') {
      if (manualQuestions.length === 0) return t.examManualNoQuestions;
      for (const q of manualQuestions) {
        if (!q.text.trim()) return t.examManualEmptyQuestion;
        if (q.options.some((o) => !o.trim())) return t.examManualEmptyOptions;
        if (!q.correctAnswer) return t.selectCorrectAnswer;
      }
    }
    return null;
  };

  // ── Forma yuborish ─────────────────────────────────────────────────────────
  const createExam = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg({ type: '', text: '' });
    const err = validate();
    if (err) { setMsg({ type: 'err', text: err }); return; }

    const startIso = toIsoOrNull(startLocal)!;
    const endIso = toIsoOrNull(endLocal)!;

    setBusy(true);
    try {
      let res: Response;

      if (method === 'pdf') {
        const fd = new FormData();
        fd.append('title', title.trim());
        fd.append('start_time', startIso);
        fd.append('end_time', endIso);
        fd.append('duration_minutes', String(duration));
        fd.append('language', language);
        fd.append('pin', pin);
        fd.append('custom_rules', customRules);
        fd.append('group_ids', JSON.stringify(selGroups));
        fd.append('exam_exceptions', JSON.stringify(exceptionsPayload));
        if (responsibleStaffId.trim()) fd.append('teacher_id', responsibleStaffId.trim());
        fd.append('pdf', pdfFile!);
        res = await fetch(apiUrl('/api/admin/exams'), {
          method: 'POST',
          headers: h,
          body: fd,
        });
      } else {
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
        };
        if (responsibleStaffId.trim()) body.teacher_id = responsibleStaffId.trim();

        if (method === 'bank') {
          const poolCount = categories
            .filter((c: any) => selCats.includes(c.id))
            .reduce((s: number, c: any) => s + Math.max(0, Number(c.question_count) || 0), 0);
          body.exam_mode = 'bank_mixed';
          body.bank_category_ids = selCats;
          body.bank_question_count = Math.min(bankCount, poolCount);
        } else {
          body.manual_questions = JSON.stringify(
            manualQuestions.map((q, i) => ({
              id: i + 1,
              text: q.text.trim(),
              options: q.options.map((o) => o.trim()),
              correctAnswer: q.correctAnswer,
            })),
          );
        }

        res = await fetch(apiUrl('/api/admin/exams'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...h },
          body: JSON.stringify(body),
        });
      }

      const d = await readJsonSafe<{ error?: string; id?: number }>(res);
      if (!res.ok) { setMsg({ type: 'err', text: d?.error || t.errorGeneric }); return; }

      const poolCount =
        method === 'bank'
          ? categories
              .filter((c: any) => selCats.includes(c.id))
              .reduce((s: number, c: any) => s + Math.max(0, Number(c.question_count) || 0), 0)
          : 0;
      const effectiveBankCount = method === 'bank' ? Math.min(bankCount, poolCount) : 0;

      setMsg({
        type: 'ok',
        text:
          method === 'bank' && effectiveBankCount !== bankCount
            ? t.examCreatedWithQuestionCountAdjusted.replace('{n}', String(effectiveBankCount))
            : t.examCreated,
      });
      // Formani tozalash
      setTitle(''); setPin(''); setCustomRules(''); setResponsibleStaffId('');
      setSelCats([]); setSelGroups([]); setExMap({});
      setPdfFile(null);
      setManualQuestions([emptyQuestion()]);
      setStartLocal(defaultExamStartLocal());
      setEndLocal(defaultExamEndLocal(duration));
      setExamKey((k) => k + 1);
    } finally {
      setBusy(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  const methodLabels: Record<ExamMethod, string> = {
    bank: t.examMethodBank,
    pdf: t.examMethodPdf,
    manual: t.examMethodManual,
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
        subtitle={
          lang === 'ru'
            ? 'Создайте новый экзамен для групп студентов'
            : lang === 'en'
              ? 'Create a new exam for student groups'
              : 'Talabalar guruhlari uchun yangi imtihon yarating'
        }
      >
        <div className="px-5 py-5 space-y-5">
          <div className="flex gap-1 p-1 bg-gray-100 rounded-lg">
            {(['bank', 'pdf', 'manual'] as ExamMethod[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMethod(m)}
                className={`flex-1 flex items-center justify-center gap-2 py-1.5 px-3 rounded-md text-[13px] font-semibold transition-colors ${
                  method === m
                    ? 'bg-white shadow-sm text-indigo-700 border border-gray-200'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {METHOD_ICONS[m]}
                <span className="hidden sm:inline">{methodLabels[m]}</span>
              </button>
            ))}
          </div>

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
                {language === 'auto' && (
                  <p className="text-[12px] text-indigo-700 mt-1.5 leading-snug">{t.examLanguageAutoHint}</p>
                )}
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
                <AdminTextarea
                  value={customRules}
                  onChange={(e) => setCustomRules(e.target.value)}
                />
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
              <AdminBtn
                type="button"
                variant="ghost"
                size="sm"
                className="mt-2"
                onClick={openExceptions}
              >
                {t.exceptionsBtn}
                {exceptionsPayload.length > 0 ? ` (${exceptionsPayload.length})` : ''}
              </AdminBtn>
            </div>

            <AnimatePresence mode="wait">
              {method === 'bank' && (
                <motion.div
                  key="bank"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  className="space-y-4"
                >
                  <div>
                    <AdminLabel required>{t.testBankCategories}</AdminLabel>
                    <p className="text-[12px] text-gray-400 mb-2">{t.examCategoriesPickHint}</p>
                    <div className="border border-gray-200 rounded-2xl overflow-hidden">
                      {categories.length === 0 ? (
                        <div className="p-4 text-center text-[13px] text-amber-700 bg-amber-50">
                          {t.testBankNeedFirst}
                        </div>
                      ) : (
                        <div className="divide-y divide-gray-100 max-h-48 overflow-y-auto">
                          {categories.map((c: any) => (
                            <label
                              key={c.id}
                              className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 cursor-pointer transition-colors"
                            >
                              <input
                                type="checkbox"
                                checked={selCats.includes(c.id)}
                                onChange={() => toggleC(c.id)}
                                className="w-4 h-4 rounded border-gray-300 accent-indigo-600"
                              />
                              <span className="text-[14px] text-gray-800 font-medium flex-1 truncate">{c.name}</span>
                              <span className="text-[12px] font-semibold text-gray-600 bg-gray-100 px-2 py-0.5 rounded-md shrink-0">
                                {c.question_count ?? 0}{' '}
                                {lang === 'ru' ? 'вопр.' : lang === 'en' ? 'qs' : 'savol'}
                              </span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <AdminField label={t.examBankQuestionCount} required>
                    <AdminInput
                      type="number"
                      min={1}
                      max={200}
                      value={bankCount}
                      onChange={(e) => setBankCount(Number(e.target.value))}
                      required
                      className="max-w-[180px]"
                    />
                  </AdminField>
                </motion.div>
              )}

              {method === 'pdf' && (
                <motion.div
                  key="pdf"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                >
                  <AdminField label={`${t.examMethodPdf} *`}>
                    <AdminFileInput
                      accept="application/pdf"
                      onChange={(e) => setPdfFile(e.target.files?.[0] ?? null)}
                    />
                    <pre className="text-[12px] text-gray-400 mt-2 whitespace-pre-wrap font-sans">
                      {t.examPdfFormatHint}
                    </pre>
                  </AdminField>
                </motion.div>
              )}

              {method === 'manual' && (
                <motion.div
                  key="manual"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  className="space-y-4"
                >
                  <p className="text-[14px] font-semibold text-gray-700">
                    {lang === 'ru' ? 'Вопросы' : lang === 'en' ? 'Questions' : 'Savollar'} ({manualQuestions.length})
                  </p>
                  {manualQuestions.map((q, qi) => (
                    <motion.div
                      key={qi}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="border border-gray-200 rounded-2xl p-4 space-y-3 bg-gray-50/40"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[13px] font-semibold text-gray-500 uppercase tracking-wide">
                          {lang === 'ru'
                            ? `Вопрос ${qi + 1}`
                            : lang === 'en'
                              ? `Question ${qi + 1}`
                              : `${qi + 1}-savol`}
                        </span>
                        {manualQuestions.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeQuestion(qi)}
                            className="text-[12px] text-red-500 hover:text-red-700 font-medium transition-colors"
                          >
                            {t.removeQuestion}
                          </button>
                        )}
                      </div>
                      <AdminInput
                        value={q.text}
                        onChange={(e) => updateQuestion(qi, { text: e.target.value })}
                        placeholder={t.questionText}
                      />
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {q.options.map((opt, oi) => (
                          <div key={oi} className="flex items-center gap-2">
                            <span
                              className={`w-6 h-6 rounded-lg flex items-center justify-center text-[12px] font-bold shrink-0 ${
                                q.correctAnswer === opt && opt.trim()
                                  ? 'bg-emerald-100 text-emerald-700'
                                  : 'bg-gray-100 text-gray-500'
                              }`}
                            >
                              {String.fromCharCode(65 + oi)}
                            </span>
                            <AdminInput
                              value={opt}
                              onChange={(e) => updateOption(qi, oi, e.target.value)}
                              placeholder={`${String.fromCharCode(65 + oi)}) ...`}
                              className="flex-1"
                            />
                          </div>
                        ))}
                      </div>
                      <div>
                        <AdminLabel>{t.selectCorrectAnswer}</AdminLabel>
                        <div className="flex flex-wrap gap-2">
                          {q.options.map((opt, oi) => (
                            <button
                              key={oi}
                              type="button"
                              disabled={!opt.trim()}
                              onClick={() => updateQuestion(qi, { correctAnswer: opt })}
                              className={`px-3 py-1.5 rounded-xl text-[13px] border font-medium transition-colors ${
                                q.correctAnswer === opt && opt.trim()
                                  ? 'bg-emerald-600 text-white border-emerald-600'
                                  : 'bg-white text-gray-700 border-gray-200 hover:border-emerald-300 disabled:opacity-30'
                              }`}
                            >
                              {String.fromCharCode(65 + oi)}
                              {opt.trim()
                                ? `: ${opt.length > 20 ? `${opt.slice(0, 20)}…` : opt}`
                                : ''}
                            </button>
                          ))}
                        </div>
                      </div>
                    </motion.div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setManualQuestions((qs) => [...qs, emptyQuestion()])}
                    className="w-full border border-dashed border-gray-300 hover:border-indigo-400 hover:bg-indigo-50/50 text-gray-500 hover:text-indigo-600 rounded-lg py-2.5 text-[13px] font-semibold transition-colors flex items-center justify-center gap-2"
                  >
                    <PlusIcon size={15} />
                    {t.addQuestion}
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

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

      <div key={examKey}>
        <AdminExamsTab token={token} lang={lang} hideExamSettings />
      </div>

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
