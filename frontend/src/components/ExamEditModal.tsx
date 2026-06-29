import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { translations, Language } from '../i18n';
import { readJsonSafe } from '../lib/http';
import { apiUrl } from '../lib/apiUrl';
import { fromIsoToDatetimeLocal } from '../lib/datetimeLocal';
import { DateTimeField } from './DateTimeField';
import { GroupMultiSelect } from './GroupMultiSelect';
import {
  AdminInput,
  AdminSelect,
  AdminField,
  AdminBtn,
  AdminAlert,
  PlusIcon,
} from '../pages/admin/ui';

function toIsoOrNull(localValue: string): string | null {
  const d = new Date(localValue);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export type ExamSavedEvent = { examId: number; deleted?: boolean };

type Props = {
  token: string;
  lang: Language;
  examId: number;
  groups: { id: number; name: string; level_name: string }[];
  onClose: () => void;
  onSaved: (ev: ExamSavedEvent) => void;
};

export function ExamEditModal({ token, lang, examId, groups, onClose, onSaved }: Props) {
  const t = translations[lang];
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [exam, setExam] = useState<any>(null);
  const [bankCats, setBankCats] = useState<any[]>([]);
  const [title, setTitle] = useState('');
  const [startLocal, setStartLocal] = useState('');
  const [endLocal, setEndLocal] = useState('');
  const [duration, setDuration] = useState(60);
  const [language, setLanguage] = useState('uz');
  const [pin, setPin] = useState('');
  const [customRules, setCustomRules] = useState('');
  const [selectedGroups, setSelectedGroups] = useState<number[]>([]);
  const [questionsJson, setQuestionsJson] = useState('');
  const [selectedBankCats, setSelectedBankCats] = useState<number[]>([]);
  const [bankCount, setBankCount] = useState(12);
  const [exceptions, setExceptions] = useState<{ student_id: string; reason: string }[]>([]);
  const [retakeList, setRetakeList] = useState<
    { id: number; student_id: string; window_start: string; window_end: string; note: string }[]
  >([]);
  const [rtStudent, setRtStudent] = useState('');
  const [rtStart, setRtStart] = useState('');
  const [rtEnd, setRtEnd] = useState('');
  const [rtNote, setRtNote] = useState('');
  const [exBusy, setExBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const res = await fetch(apiUrl(`/api/admin/exams/${examId}`), { headers: { Authorization: `Bearer ${token}` } });
        const data = await readJsonSafe<any>(res);
        if (!res.ok) throw new Error(data?.error || t.examLoadFailed);
        if (!data) throw new Error(t.loginInvalidServerResponse);
        if (cancelled) return;
        setExam(data);
        setTitle(data.title);
        setStartLocal(fromIsoToDatetimeLocal(data.start_time));
        setEndLocal(fromIsoToDatetimeLocal(data.end_time));
        setDuration(Number(data.duration_minutes) || 60);
        setLanguage(data.language || 'uz');
        setPin(data.pin || '');
        setCustomRules(data.custom_rules || '');
        setSelectedGroups(Array.isArray(data.group_ids) ? data.group_ids : []);
        setQuestionsJson(JSON.stringify(data.questions || [], null, 2));
        setSelectedBankCats(Array.isArray(data.bank_category_ids) ? data.bank_category_ids : []);
        setBankCount(Number(data.bank_question_count) || 12);
        setExceptions(Array.isArray(data.exceptions) ? data.exceptions : []);
        setRetakeList(Array.isArray(data.retake_windows) ? data.retake_windows : []);
        if (data.exam_mode === 'bank_mixed') {
          const cr = await fetch(apiUrl('/api/admin/test-bank/categories'), { headers: { Authorization: `Bearer ${token}` } });
          if (cr.ok && !cancelled) {
            const cats = await readJsonSafe<any[]>(cr);
            setBankCats(Array.isArray(cats) ? cats : []);
          }
        }
      } catch (e: any) {
        if (!cancelled) setError(e.message || t.errorGeneric);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [examId, token, t]);

  const toggleBankCat = (id: number) => {
    setSelectedBankCats((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleSave = async () => {
    if (selectedGroups.length === 0) {
      setError(t.examCreateSelectGroup);
      return;
    }
    setSaving(true);
    setError('');
    try {
      const startIso = toIsoOrNull(startLocal);
      const endIso = toIsoOrNull(endLocal);
      if (!startIso || !endIso) {
        setError(t.examInvalidDateTime);
        setSaving(false);
        return;
      }
      const body: Record<string, unknown> = {
        title,
        start_time: startIso,
        end_time: endIso,
        duration_minutes: duration,
        language,
        pin,
        custom_rules: customRules,
        group_ids: selectedGroups,
      };
      if (exam?.exam_mode === 'static') {
        try {
          const parsed = JSON.parse(questionsJson);
          if (Array.isArray(parsed) && parsed.length > 0) body.questions = parsed;
        } catch {
          setError(t.testBankInvalidJson);
          setSaving(false);
          return;
        }
      }
      if (exam?.exam_mode === 'bank_mixed') {
        const selectedPoolCount = bankCats
          .filter((c: any) => selectedBankCats.includes(c.id))
          .reduce((sum: number, c: any) => sum + Math.max(0, Number(c.question_count) || 0), 0);
        if (selectedPoolCount < 1) {
          setError(t.examCreateBankCategoriesEmpty);
          setSaving(false);
          return;
        }
        body.bank_category_ids = selectedBankCats;
        body.bank_question_count = Math.min(
          Math.max(1, Math.min(200, Number(bankCount) || 1)),
          selectedPoolCount,
        );
      }
      const res = await fetch(apiUrl(`/api/admin/exams/${examId}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const data = (await readJsonSafe<{ error?: string }>(res)) || {};
      if (!res.ok) throw new Error(data.error || t.examSaveFailed);
      onSaved({ examId });
      onClose();
    } catch (e: any) {
      setError(e.message || t.errorGeneric);
    } finally {
      setSaving(false);
    }
  };

  const saveExceptions = async () => {
    setExBusy(true);
    setError('');
    try {
      const res = await fetch(apiUrl(`/api/admin/exams/${examId}/exceptions`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ items: exceptions }),
      });
      const data = (await readJsonSafe<{ error?: string }>(res)) || {};
      if (!res.ok) throw new Error(data.error || t.examSaveFailed);
    } catch (e: any) {
      setError(e.message || t.errorGeneric);
    } finally {
      setExBusy(false);
    }
  };

  const addExceptionRow = () => {
    setExceptions((p) => [...p, { student_id: '', reason: '' }]);
  };

  const addRetake = async () => {
    if (!rtStudent.trim() || !rtStart || !rtEnd) {
      setError(t.retakeWindowNeedFields);
      return;
    }
    setExBusy(true);
    setError('');
    try {
      const res = await fetch(apiUrl(`/api/admin/exams/${examId}/retake-windows`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          student_id: rtStudent.trim(),
          window_start: new Date(rtStart).toISOString(),
          window_end: new Date(rtEnd).toISOString(),
          note: rtNote,
        }),
      });
      const data = (await readJsonSafe<{ error?: string; id?: number }>(res)) || {};
      if (!res.ok) throw new Error(data.error || t.examSaveFailed);
      const r2 = await fetch(apiUrl(`/api/admin/exams/${examId}`), { headers: { Authorization: `Bearer ${token}` } });
      const ex = await readJsonSafe<any>(r2);
      if (r2.ok && ex?.retake_windows) setRetakeList(ex.retake_windows);
      setRtStudent('');
      setRtNote('');
    } catch (e: any) {
      setError(e.message || t.errorGeneric);
    } finally {
      setExBusy(false);
    }
  };

  const delRetake = async (wid: number) => {
    setExBusy(true);
    setError('');
    try {
      const res = await fetch(apiUrl(`/api/admin/exams/${examId}/retake-windows/${wid}`), {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = (await readJsonSafe<{ error?: string }>(res)) || {};
        throw new Error(data.error || t.examDeleteFailed);
      }
      setRetakeList((p) => p.filter((x) => x.id !== wid));
    } catch (e: any) {
      setError(e.message || t.errorGeneric);
    } finally {
      setExBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(t.confirmDeleteExam)) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch(apiUrl(`/api/admin/exams/${examId}`), {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await readJsonSafe<{ error?: string }>(res)) || {};
      if (!res.ok) throw new Error(data.error || t.examDeleteFailed);
      onSaved({ examId, deleted: true });
      onClose();
    } catch (e: any) {
      setError(e.message || t.errorGeneric);
    } finally {
      setSaving(false);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-white rounded-3xl shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-gray-100 px-6 py-4 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-[17px] font-bold text-gray-900 truncate">{t.editExam}</h3>
              {exam?.title && (
                <p className="text-[13px] text-gray-400 mt-0.5 truncate">{exam.title}</p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-9 h-9 rounded-xl bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors shrink-0"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="px-6 py-5 space-y-5">
            {loading && (
              <p className="text-[14px] text-gray-400 text-center py-10">{t.loading}</p>
            )}
            {error && <AdminAlert type="error">{error}</AdminAlert>}

            {!loading && exam && (
              <>
                <AdminField label={t.title} required>
                  <AdminInput value={title} onChange={(e) => setTitle(e.target.value)} />
                </AdminField>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <AdminField label={t.startTime} required>
                    <DateTimeField
                      value={startLocal}
                      onChange={setStartLocal}
                      dateLabel={t.examDateLabel}
                      timeLabel={t.examTimeLabel}
                    />
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

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  <AdminField label={`${t.duration} (min)`} required>
                    <AdminInput
                      type="number"
                      min={5}
                      value={duration}
                      onChange={(e) => setDuration(Number(e.target.value))}
                    />
                  </AdminField>
                  <AdminField label={t.language}>
                    <AdminSelect value={language} onChange={(e) => setLanguage(e.target.value)}>
                      <option value="uz">{t.langUzbek}</option>
                      <option value="ru">{t.langRussian}</option>
                      <option value="en">{t.langEnglish}</option>
                    </AdminSelect>
                  </AdminField>
                  <AdminField label={`${t.pin} (opt.)`}>
                    <AdminInput value={pin} onChange={(e) => setPin(e.target.value)} placeholder="—" />
                  </AdminField>
                </div>

                <AdminField label={`${t.customRules} (opt.)`}>
                  <textarea
                    value={customRules}
                    onChange={(e) => setCustomRules(e.target.value)}
                    className="w-full min-h-[72px] rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-[15px] text-gray-900 placeholder:text-gray-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-violet-400/40 focus:border-violet-400 transition-all resize-y"
                  />
                </AdminField>

                <div>
                  <label className="text-[13px] font-medium text-gray-600 block mb-2">
                    {t.selectGroups} <span className="text-red-500">*</span>
                  </label>
                  <GroupMultiSelect
                    groups={groups}
                    value={selectedGroups}
                    onChange={setSelectedGroups}
                    lang={lang}
                  />
                </div>

                {exam.exam_mode === 'static' && (
                  <AdminField label={t.examQuestionsJsonHint}>
                    <textarea
                      value={questionsJson}
                      onChange={(e) => setQuestionsJson(e.target.value)}
                      className="w-full min-h-[160px] font-mono text-[12px] rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-gray-800 focus:outline-none focus:ring-2 focus:ring-violet-400/40 focus:border-violet-400 transition-all resize-y"
                    />
                  </AdminField>
                )}

                {exam.exam_mode === 'bank_mixed' && (
                  <div className="space-y-4">
                    <div>
                      <label className="text-[13px] font-medium text-gray-600 block mb-2">
                        {t.bankCategoriesEdit}
                      </label>
                      <div className="border border-gray-200 rounded-2xl overflow-hidden">
                        {bankCats.length === 0 ? (
                          <div className="p-4 text-center text-[13px] text-amber-700 bg-amber-50">
                            {t.testBankNeedFirst}
                          </div>
                        ) : (
                          <div className="divide-y divide-gray-100 max-h-40 overflow-y-auto">
                            {bankCats.map((c: any) => (
                              <label
                                key={c.id}
                                className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 cursor-pointer transition-colors"
                              >
                                <input
                                  type="checkbox"
                                  checked={selectedBankCats.includes(c.id)}
                                  onChange={() => toggleBankCat(c.id)}
                                  className="w-4 h-4 rounded border-gray-300 text-violet-600 accent-violet-600"
                                />
                                <span className="text-[14px] text-gray-800 font-medium flex-1 truncate">{c.name}</span>
                                <span className="text-[12px] font-semibold text-violet-700 bg-violet-100 px-2 py-0.5 rounded-full shrink-0">
                                  {c.question_count ?? 0}
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
                        className="max-w-[180px]"
                      />
                    </AdminField>
                  </div>
                )}

                <div className="space-y-3 pt-2 border-t border-gray-100">
                  <div>
                    <p className="text-[14px] font-semibold text-gray-800">{t.exceptionsTitle}</p>
                    <p className="text-[12px] text-gray-500 mt-0.5">{t.exceptionsHint}</p>
                  </div>
                  {exceptions.map((row, i) => (
                    <div key={i} className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <AdminInput
                        placeholder="student_id"
                        value={row.student_id}
                        onChange={(e) => {
                          const v = e.target.value;
                          setExceptions((p) => p.map((x, j) => (j === i ? { ...x, student_id: v } : x)));
                        }}
                      />
                      <AdminInput
                        placeholder={t.exceptionReason}
                        value={row.reason}
                        onChange={(e) => {
                          const v = e.target.value;
                          setExceptions((p) => p.map((x, j) => (j === i ? { ...x, reason: v } : x)));
                        }}
                      />
                    </div>
                  ))}
                  <div className="flex flex-wrap gap-2">
                    <AdminBtn type="button" variant="ghost" size="sm" icon={<PlusIcon size={14} />} onClick={addExceptionRow}>
                      + istisno
                    </AdminBtn>
                    <AdminBtn type="button" variant="violet" size="sm" loading={exBusy} onClick={saveExceptions}>
                      {t.save} (istisnolar)
                    </AdminBtn>
                  </div>
                </div>

                <div className="space-y-3 pt-2 border-t border-gray-100">
                  <p className="text-[14px] font-semibold text-gray-800">{t.retakeSectionTitle}</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <AdminField label={t.retakeStudent}>
                      <AdminInput value={rtStudent} onChange={(e) => setRtStudent(e.target.value)} />
                    </AdminField>
                    <AdminField label={t.retakeNote}>
                      <AdminInput value={rtNote} onChange={(e) => setRtNote(e.target.value)} />
                    </AdminField>
                    <AdminField label={t.startTime}>
                      <DateTimeField
                        value={rtStart}
                        onChange={setRtStart}
                        dateLabel={t.examDateLabel}
                        timeLabel={t.examTimeLabel}
                      />
                    </AdminField>
                    <AdminField label={t.endTime}>
                      <DateTimeField
                        value={rtEnd}
                        onChange={setRtEnd}
                        min={rtStart || undefined}
                        dateLabel={t.examDateLabel}
                        timeLabel={t.examTimeLabel}
                      />
                    </AdminField>
                  </div>
                  <AdminBtn type="button" variant="ghost" size="sm" loading={exBusy} onClick={addRetake}>
                    {t.retakeAddBtn}
                  </AdminBtn>
                  {retakeList.length > 0 && (
                    <ul className="space-y-2 max-h-36 overflow-y-auto">
                      {retakeList.map((rw) => (
                        <li
                          key={rw.id}
                          className="flex items-center justify-between gap-2 p-3 rounded-xl bg-gray-50 border border-gray-200 text-[12px]"
                        >
                          <span className="font-mono font-medium text-gray-800 shrink-0">{rw.student_id}</span>
                          <span className="text-gray-500 truncate text-center flex-1">
                            {new Date(rw.window_start).toLocaleString()} — {new Date(rw.window_end).toLocaleString()}
                          </span>
                          <button
                            type="button"
                            className="text-red-500 hover:text-red-700 font-bold shrink-0 w-7 h-7 rounded-lg hover:bg-red-50 transition-colors"
                            onClick={() => delRetake(rw.id)}
                          >
                            ×
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-3 pt-4 border-t border-gray-100">
                  <AdminBtn type="button" variant="blue" loading={saving} onClick={handleSave}>
                    {t.save}
                  </AdminBtn>
                  <AdminBtn type="button" variant="ghost" onClick={onClose}>
                    {t.cancel}
                  </AdminBtn>
                  <AdminBtn
                    type="button"
                    variant="red-ghost"
                    className="ml-auto"
                    loading={saving}
                    onClick={handleDelete}
                  >
                    {t.delete}
                  </AdminBtn>
                </div>
              </>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
