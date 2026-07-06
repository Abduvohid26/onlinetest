import React, { useState, useEffect, useCallback } from 'react';
import { translations, Language } from '../i18n';
import { motion, AnimatePresence } from 'motion/react';
import { readJsonSafe } from '../lib/http';
import { apiUrl } from '../lib/apiUrl';
import { defaultExamEndLocal, defaultExamStartLocal, isValidDatetimeLocal } from '../lib/datetimeLocal';
import { DateTimeField } from './DateTimeField';
import { GroupMultiSelect } from './GroupMultiSelect';
import { AdminInput, AdminSelect, AdminField, AdminBtn, AdminCard, AdminAlert, PlusIcon } from '../pages/admin/ui';

interface ExamSettingsProps {
  token: string;
  lang: Language;
  groups: any[];
  onSuccess: () => void;
}

type Method = 'pdf' | 'manual' | 'bank';

const METHOD_ICONS: Record<Method, React.ReactNode> = {
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
  bank: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
    </svg>
  ),
};

export function ExamSettings({ token, lang, groups, onSuccess }: ExamSettingsProps) {
  const [method, setMethod] = useState<Method>('pdf');
  const [bankCategories, setBankCategories] = useState<any[]>([]);
  const [manualQuestions, setManualQuestions] = useState([{ text: '', options: ['', '', '', ''], correctAnswer: '' }]);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [startLocal, setStartLocal] = useState(defaultExamStartLocal);
  const [endLocal, setEndLocal] = useState(() => defaultExamEndLocal(60));
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [title, setTitle] = useState('');
  const [language, setLanguage] = useState('uz');
  const [pin, setPin] = useState('');
  const [customRules, setCustomRules] = useState('');
  const [bankQuestionCount, setBankQuestionCount] = useState(20);
  const [submitting, setSubmitting] = useState(false);
  const [selectedGroups, setSelectedGroups] = useState<Set<number>>(new Set());
  const t = translations[lang];

  const resetForm = useCallback(() => {
    setTitle('');
    setPin('');
    setCustomRules('');
    setStartLocal(defaultExamStartLocal);
    setEndLocal(defaultExamEndLocal(60));
    setDurationMinutes(60);
    setSelectedGroups(new Set());
    setManualQuestions([{ text: '', options: ['', '', '', ''], correctAnswer: '' }]);
    setBankQuestionCount(20);
  }, []);

  useEffect(() => {
    if (method !== 'bank') return;
    (async () => {
      const res = await fetch(apiUrl('/api/admin/test-bank/categories'), { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) { const raw = await readJsonSafe<unknown>(res); setBankCategories(Array.isArray(raw) ? raw : []); }
    })();
  }, [method, token]);

  const [selectedBankCats, setSelectedBankCats] = useState<Set<number>>(new Set());

  const toggleBankCat = (id: number) => {
    setSelectedBankCats((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleCreateExam = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setMsg(null);

    if (selectedGroups.size === 0) { setMsg({ type: 'err', text: t.examCreateSelectGroup }); return; }
    if (!isValidDatetimeLocal(startLocal) || !isValidDatetimeLocal(endLocal)) { setMsg({ type: 'err', text: t.examDateTimeRequired }); return; }

    const fd = new FormData();
    fd.set('title', title);
    fd.set('language', language);
    fd.set('pin', pin);
    fd.set('custom_rules', customRules);
    fd.set('start_time', startLocal);
    fd.set('end_time', endLocal);
    fd.set('duration_minutes', String(durationMinutes));
    fd.set('group_ids', JSON.stringify([...selectedGroups]));

    if (method === 'pdf') {
      const fileInput = (e.currentTarget.querySelector('input[type="file"]') as HTMLInputElement);
      const file = fileInput?.files?.[0];
      if (!file) { setMsg({ type: 'err', text: t.testBankAiNeedPdf }); return; }
      fd.set('pdf', file);
    }

    if (method === 'bank') {
      const catIds = [...selectedBankCats];
      if (catIds.length === 0) { setMsg({ type: 'err', text: t.testBankPickCategory }); return; }
      const poolCount = bankCategories.filter((c: any) => catIds.includes(Number(c.id))).reduce((s: number, c: any) => s + Math.max(0, Number(c.question_count) || 0), 0);
      if (poolCount < 1) { setMsg({ type: 'err', text: t.examCreateBankCategoriesEmpty }); return; }
      fd.set('exam_mode', 'bank_mixed');
      fd.set('bank_category_ids', JSON.stringify(catIds));
      fd.set('bank_question_count', String(Math.min(Math.max(1, bankQuestionCount), poolCount)));
    }

    if (method === 'manual') {
      fd.set('manual_questions', JSON.stringify(
        manualQuestions.map((q, i) => ({ id: i + 1, text: q.text, options: q.options, correctAnswer: q.correctAnswer || q.options[0] }))
      ));
    }

    setSubmitting(true);
    try {
      const res = await fetch(apiUrl('/api/admin/exams'), { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
      const data = await readJsonSafe<{ error?: string }>(res);
      if (!res.ok) { setMsg({ type: 'err', text: data?.error || t.examCreateFailed }); return; }
      setMsg({ type: 'ok', text: t.examCreatedOk });
      resetForm();
      setSelectedBankCats(new Set());
      onSuccess();
      setTimeout(() => setMsg(null), 4000);
    } catch {
      setMsg({ type: 'err', text: t.examCreateError });
    } finally {
      setSubmitting(false);
    }
  };

  const addManualQuestion = () => {
    setManualQuestions([...manualQuestions, { text: '', options: ['', '', '', ''], correctAnswer: '' }]);
  };

  const removeManualQuestion = (idx: number) => {
    setManualQuestions((prev) => prev.filter((_, i) => i !== idx));
  };

  return (
    <AdminCard
      icon={
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
      }
      iconBg="bg-blue-600"
      title={t.addExam}
      subtitle={lang === 'ru' ? 'Создайте новый экзамен для групп студентов' : lang === 'en' ? 'Create a new exam for student groups' : 'Talabalar guruhlari uchun yangi imtihon yarating'}
      borderColor="border-blue-200"
      headerBg="bg-blue-50/40"
    >
      <div className="px-5 py-5 space-y-5">
        {/* Method tabs */}
        <div className="flex gap-2 p-1 bg-gray-100 rounded-2xl">
          {(['pdf', 'manual', 'bank'] as Method[]).map((m) => {
            const labels: Record<Method, string> = {
              pdf: t.uploadPdf,
              manual: t.manualEntry,
              bank: t.examModeBank,
            };
            return (
              <button
                key={m}
                type="button"
                onClick={() => setMethod(m)}
                className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-xl text-[13px] font-semibold transition-all ${method === m ? 'bg-white shadow-sm text-blue-700 border border-blue-100' : 'text-gray-500 hover:text-gray-700'}`}
              >
                {METHOD_ICONS[m]}
                <span className="hidden sm:inline">{labels[m]}</span>
              </button>
            );
          })}
        </div>

        <AnimatePresence mode="wait">
          {msg && (
            <motion.div key={msg.type + msg.text} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <AdminAlert type={msg.type === 'ok' ? 'success' : 'error'}>{msg.text}</AdminAlert>
            </motion.div>
          )}
        </AnimatePresence>

        <form onSubmit={handleCreateExam} noValidate className="space-y-5">
          {/* ── Asosiy ma'lumotlar ── */}
          <div className="p-4 bg-gray-50/60 rounded-xl border border-gray-100 space-y-4">
            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">
              {lang === 'ru' ? 'Основная информация' : lang === 'en' ? 'Basic info' : 'Asosiy ma\'lumotlar'}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_180px] gap-4">
              <AdminField label={t.title} required>
                <AdminInput
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                  placeholder={lang === 'ru' ? 'Анатомия — весенний семестр 2025' : lang === 'en' ? 'Anatomy — Spring 2025' : 'Anatomiya — 2025 bahor semestri'}
                />
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
          </div>

          {/* ── Vaqt ── */}
          <div className="p-4 bg-gray-50/60 rounded-xl border border-gray-100 space-y-4">
            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">
              {lang === 'ru' ? 'Расписание' : lang === 'en' ? 'Schedule' : 'Vaqt jadvali'}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <AdminField label={t.startTime} required>
                <DateTimeField value={startLocal} onChange={setStartLocal} dateLabel={t.examDateLabel} timeLabel={t.examTimeLabel} />
              </AdminField>
              <AdminField label={t.endTime} required>
                <DateTimeField value={endLocal} onChange={setEndLocal} min={startLocal || undefined} dateLabel={t.examDateLabel} timeLabel={t.examTimeLabel} />
              </AdminField>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <AdminField label={`${t.duration} (min)`} required>
                <AdminInput
                  type="number"
                  min={5}
                  value={durationMinutes}
                  onChange={(e) => setDurationMinutes(Number(e.target.value))}
                  required
                />
              </AdminField>
              <AdminField label={`${t.pin} (opt.)`}>
                <AdminInput value={pin} onChange={(e) => setPin(e.target.value)} type="text" placeholder="1234" />
              </AdminField>
              <AdminField label={`${t.customRules} (opt.)`}>
                <AdminInput
                  value={customRules}
                  onChange={(e) => setCustomRules(e.target.value)}
                  placeholder={lang === 'ru' ? 'Калькулятор запрещён' : lang === 'en' ? 'No calculator allowed' : "Kalkulyator taqiqlangan"}
                />
              </AdminField>
            </div>
          </div>

          {/* ── Guruhlar ── */}
          <div className="p-4 bg-gray-50/60 rounded-xl border border-gray-100 space-y-3">
            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">
              {lang === 'ru' ? 'Группы студентов' : lang === 'en' ? 'Student groups' : 'Talabalar guruhlari'} <span className="text-red-400 normal-case text-[13px]">*</span>
            </p>
            <GroupMultiSelect
              groups={groups}
              value={[...selectedGroups]}
              onChange={(ids) => setSelectedGroups(new Set(ids))}
              lang={lang}
            />
          </div>

          {/* ── Savol usuli ── */}
          <div className="p-4 bg-gray-50/60 rounded-xl border border-gray-100 space-y-4">
            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">
              {lang === 'ru' ? 'Источник вопросов' : lang === 'en' ? 'Question source' : 'Savollar manbai'}
            </p>
            <AnimatePresence mode="wait">
              {method === 'pdf' && (
                <motion.div key="pdf" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}>
                  <AdminField label={`${t.uploadPdf} *`}>
                    <AdminInput
                      type="file"
                      name="pdf"
                      accept="application/pdf"
                      className="h-11 pt-2.5 text-[13px] cursor-pointer"
                    />
                    <p className="text-[12px] text-gray-400 mt-1">
                      {lang === 'ru' ? 'Формат: 1. Вопрос, A) Правильный, B) Неправильный...' : lang === 'en' ? 'Format: 1. Question, A) Correct, B) Wrong...' : "Format: 1. Savol matni, A) To'g'ri javob, B) Noto'g'ri..."}
                    </p>
                  </AdminField>
                </motion.div>
              )}

              {method === 'bank' && (
                <motion.div key="bank" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="space-y-4">
                  <div>
                    <label className="text-[13px] font-medium text-gray-600 block mb-1">{t.testBankCategories} <span className="text-red-500">*</span></label>
                    <p className="text-[12px] text-gray-400 mb-2">{t.examCategoriesPickHint}</p>
                    <div className="border border-gray-200 rounded-2xl overflow-hidden">
                      {bankCategories.length === 0 ? (
                        <div className="p-4 text-center text-[13px] text-amber-700 bg-amber-50">{t.testBankNeedFirst}</div>
                      ) : (
                        <div className="divide-y divide-gray-100 max-h-48 overflow-y-auto">
                          {bankCategories.map((c: any) => (
                            <label key={c.id} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 cursor-pointer transition-colors">
                              <input
                                type="checkbox"
                                checked={selectedBankCats.has(c.id)}
                                onChange={() => toggleBankCat(c.id)}
                                className="w-4 h-4 rounded border-gray-300 text-violet-600 accent-violet-600"
                              />
                              <span className="text-[14px] text-gray-800 font-medium flex-1 truncate">{c.name}</span>
                              <span className="text-[12px] font-semibold text-violet-700 bg-violet-100 px-2 py-0.5 rounded-full shrink-0">
                                {c.question_count ?? 0} {lang === 'ru' ? 'вопр.' : lang === 'en' ? 'qs' : 'savol'}
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
                      value={bankQuestionCount}
                      onChange={(e) => setBankQuestionCount(Number(e.target.value))}
                      required
                      className="max-w-[180px]"
                    />
                  </AdminField>
                </motion.div>
              )}

              {method === 'manual' && (
                <motion.div key="manual" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="space-y-4">
                  <p className="text-[14px] font-semibold text-gray-700">
                    {lang === 'ru' ? 'Вопросы' : lang === 'en' ? 'Questions' : 'Savollar'} ({manualQuestions.length})
                  </p>
                  {manualQuestions.map((q, i) => (
                    <motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                      className="border border-gray-200 rounded-2xl p-4 space-y-3 bg-white">
                      <div className="flex items-center justify-between">
                        <span className="text-[13px] font-semibold text-gray-500 uppercase tracking-wide">
                          {lang === 'ru' ? `Вопрос ${i + 1}` : lang === 'en' ? `Question ${i + 1}` : `${i + 1}-savol`}
                        </span>
                        {manualQuestions.length > 1 && (
                          <button type="button" onClick={() => removeManualQuestion(i)}
                            className="text-[12px] text-red-500 hover:text-red-700 font-medium transition-colors">
                            {t.delete}
                          </button>
                        )}
                      </div>
                      <AdminInput
                        value={q.text}
                        onChange={(e) => { const n = [...manualQuestions]; n[i].text = e.target.value; setManualQuestions(n); }}
                        placeholder={lang === 'ru' ? 'Текст вопроса...' : lang === 'en' ? 'Question text...' : 'Savol matni...'}
                        required
                      />
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {q.options.map((opt, optIdx) => (
                          <div key={optIdx} className="flex items-center gap-2">
                            <span className={`w-6 h-6 rounded-lg flex items-center justify-center text-[12px] font-bold shrink-0 ${optIdx === 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                              {String.fromCharCode(65 + optIdx)}
                            </span>
                            <AdminInput
                              value={opt}
                              onChange={(e) => {
                                const n = [...manualQuestions];
                                n[i].options[optIdx] = e.target.value;
                                if (optIdx === 0) n[i].correctAnswer = e.target.value;
                                setManualQuestions(n);
                              }}
                              placeholder={optIdx === 0
                                ? (lang === 'ru' ? 'Правильный ответ' : lang === 'en' ? 'Correct answer' : "To'g'ri javob")
                                : `${String.fromCharCode(65 + optIdx)} ${lang === 'ru' ? 'вариант' : lang === 'en' ? 'option' : 'variant'}`}
                              required className="flex-1"
                            />
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  ))}
                  <button
                    type="button"
                    onClick={addManualQuestion}
                    className="w-full border-2 border-dashed border-gray-300 hover:border-blue-400 hover:bg-blue-50 text-gray-500 hover:text-blue-600 rounded-2xl py-3 text-[13px] font-semibold transition-all flex items-center justify-center gap-2"
                  >
                    <PlusIcon size={15} />
                    {t.addQuestion}
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Submit */}
          <AdminBtn
            type="submit"
            variant="blue"
            size="lg"
            loading={submitting}
            icon={<PlusIcon size={16} />}
            disabled={method === 'bank' && bankCategories.length === 0}
            className="w-full"
          >
            {t.createExam}
          </AdminBtn>
        </form>
      </div>
    </AdminCard>
  );
}
