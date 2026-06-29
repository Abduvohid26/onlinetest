import React, { useState, useEffect } from 'react';
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
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [startLocal, setStartLocal] = useState(defaultExamStartLocal);
  const [endLocal, setEndLocal] = useState(() => defaultExamEndLocal(60));
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [submitting, setSubmitting] = useState(false);
  const [selectedGroups, setSelectedGroups] = useState<Set<number>>(new Set());
  const t = translations[lang];

  useEffect(() => {
    if (method !== 'bank') return;
    (async () => {
      const res = await fetch(apiUrl('/api/admin/test-bank/categories'), { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) { const raw = await readJsonSafe<unknown>(res); setBankCategories(Array.isArray(raw) ? raw : []); }
    })();
  }, [method, token]);

  const handleCreateExam = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formEl = e.currentTarget;
    setError(''); setSuccess('');

    if (selectedGroups.size === 0) { setError(t.examCreateSelectGroup); return; }
    if (!isValidDatetimeLocal(startLocal) || !isValidDatetimeLocal(endLocal)) { setError(t.examDateTimeRequired); return; }

    const fd = new FormData(formEl);
    fd.set('start_time', startLocal);
    fd.set('end_time', endLocal);
    fd.set('duration_minutes', String(durationMinutes));
    fd.delete('group_ids');
    fd.append('group_ids', JSON.stringify([...selectedGroups]));

    if (method === 'bank') {
      const catIds = Array.from(fd.getAll('bank_category_ids')).map(Number).filter(Boolean);
      if (catIds.length === 0) { setError(t.testBankPickCategory); return; }
      const poolCount = bankCategories.filter((c: any) => catIds.includes(Number(c.id))).reduce((s: number, c: any) => s + Math.max(0, Number(c.question_count) || 0), 0);
      if (poolCount < 1) { setError(t.examCreateBankCategoriesEmpty); return; }
      fd.delete('bank_category_ids');
      fd.append('exam_mode', 'bank_mixed');
      fd.append('bank_category_ids', JSON.stringify(catIds));
      const cnt = Math.max(1, Math.min(200, Number(fd.get('bank_question_count')) || 1));
      fd.delete('bank_question_count');
      fd.append('bank_question_count', String(Math.min(cnt, poolCount)));
    }

    if (method === 'manual') {
      fd.append('manual_questions', JSON.stringify(
        manualQuestions.map((q, i) => ({ id: i + 1, text: q.text, options: q.options, correctAnswer: q.correctAnswer || q.options[0] }))
      ));
    }

    setSubmitting(true);
    try {
      const res = await fetch(apiUrl('/api/admin/exams'), { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
      const data = await readJsonSafe<{ error?: string }>(res);
      if (!res.ok) { setError(data?.error || t.examCreateFailed); return; }
      setSuccess(lang === 'ru' ? '✓ Экзамен создан успешно!' : lang === 'en' ? '✓ Exam created successfully!' : '✓ Imtihon muvaffaqiyatli yaratildi!');
      formEl.reset();
      setManualQuestions([{ text: '', options: ['', '', '', ''], correctAnswer: '' }]);
      setSelectedGroups(new Set());
      onSuccess();
      setTimeout(() => setSuccess(''), 3000);
    } catch {
      setError(t.examCreateError);
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

        {error && <AdminAlert type="error">{error}</AdminAlert>}
        {success && <AdminAlert type="success">{success}</AdminAlert>}

        <form onSubmit={handleCreateExam} noValidate className="space-y-5">
          {/* Row 1: Title + Language */}
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_180px] gap-4">
            <AdminField label={t.title} required>
              <AdminInput name="title" required placeholder={lang === 'ru' ? 'Анатомия — весенний семестр 2025' : lang === 'en' ? 'Anatomy — Spring 2025' : 'Anatomiya — 2025 bahor semestri'} />
            </AdminField>
            <AdminField label={t.language}>
              <AdminSelect name="language">
                <option value="uz">{t.langUzbek}</option>
                <option value="ru">{t.langRussian}</option>
                <option value="en">{t.langEnglish}</option>
              </AdminSelect>
            </AdminField>
          </div>

          {/* Row 2: Start + End dates */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <AdminField label={t.startTime} required>
              <DateTimeField value={startLocal} onChange={setStartLocal} dateLabel={t.examDateLabel} timeLabel={t.examTimeLabel} />
            </AdminField>
            <AdminField label={t.endTime} required>
              <DateTimeField value={endLocal} onChange={setEndLocal} min={startLocal || undefined} dateLabel={t.examDateLabel} timeLabel={t.examTimeLabel} />
            </AdminField>
          </div>

          {/* Row 3: Duration + PIN */}
          <div className="grid grid-cols-2 sm:grid-cols-[160px_160px_1fr] gap-4">
            <AdminField label={`${t.duration} (min)`} required>
              <AdminInput
                name="duration_minutes"
                type="number"
                min={5}
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(Number(e.target.value))}
                required
              />
            </AdminField>
            <AdminField label={`${t.pin} (opt.)`}>
              <AdminInput name="pin" type="text" placeholder="1234" />
            </AdminField>
            <AdminField label={`${t.customRules} (opt.)`} className="sm:col-span-1">
              <AdminInput name="custom_rules" placeholder={lang === 'ru' ? 'Калькулятор запрещён' : lang === 'en' ? 'No calculator allowed' : "Kalkulyator taqiqlangan"} />
            </AdminField>
          </div>

          {/* Groups picker */}
          <div>
            <label className="text-[13px] font-medium text-gray-600 block mb-2">
              {t.selectGroups} <span className="text-red-500">*</span>
            </label>
            <GroupMultiSelect
              groups={groups}
              value={[...selectedGroups]}
              onChange={(ids) => setSelectedGroups(new Set(ids))}
              lang={lang}
            />
          </div>

          {/* PDF upload */}
          <AnimatePresence mode="wait">
            {method === 'pdf' && (
              <motion.div key="pdf" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}>
                <AdminField label={`${t.uploadPdf} *`}>
                  <AdminInput
                    type="file"
                    name="pdf"
                    accept="application/pdf"
                    required
                    className="h-11 pt-2.5 text-[13px] cursor-pointer"
                  />
                  <p className="text-[12px] text-gray-400 mt-1">
                    {lang === 'ru' ? 'Формат: 1. Вопрос \\n A) Правильный \\n B) Неправильный...' : lang === 'en' ? 'Format: 1. Question text \\n A) Correct \\n B) Wrong...' : "Format: 1. Savol matni \\n A) To'g'ri javob \\n B) Noto'g'ri..."}
                  </p>
                </AdminField>
              </motion.div>
            )}

            {/* Bank mode */}
            {method === 'bank' && (
              <motion.div key="bank" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-[13px] font-medium text-gray-600">{t.testBankCategories} <span className="text-red-500">*</span></label>
                  </div>
                  <div className="border border-gray-200 rounded-2xl overflow-hidden">
                    {bankCategories.length === 0 ? (
                      <div className="p-4 text-center text-[13px] text-amber-700 bg-amber-50">{t.testBankNeedFirst}</div>
                    ) : (
                      <div className="divide-y divide-gray-100 max-h-48 overflow-y-auto">
                        {bankCategories.map((c: any) => (
                          <label key={c.id} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 cursor-pointer transition-colors">
                            <input type="checkbox" name="bank_category_ids" value={c.id}
                              className="w-4 h-4 rounded border-gray-300 text-violet-600 focus:ring-violet-400/40 accent-violet-600" />
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
                  <AdminInput name="bank_question_count" type="number" min={1} max={200} defaultValue={20} required className="max-w-[180px]" />
                </AdminField>
              </motion.div>
            )}

            {/* Manual mode */}
            {method === 'manual' && (
              <motion.div key="manual" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-[14px] font-semibold text-gray-700">
                    {lang === 'ru' ? 'Вопросы' : lang === 'en' ? 'Questions' : 'Savollar'} ({manualQuestions.length})
                  </p>
                </div>
                {manualQuestions.map((q, i) => (
                  <motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                    className="border border-gray-200 rounded-2xl p-4 space-y-3 bg-gray-50/40">
                    <div className="flex items-center justify-between">
                      <span className="text-[13px] font-semibold text-gray-500 uppercase tracking-wide">
                        {lang === 'ru' ? `Вопрос ${i + 1}` : lang === 'en' ? `Question ${i + 1}` : `${i + 1}-savol`}
                      </span>
                      {manualQuestions.length > 1 && (
                        <button type="button" onClick={() => removeManualQuestion(i)}
                          className="text-[12px] text-red-500 hover:text-red-700 font-medium transition-colors">
                          {lang === 'ru' ? 'Удалить' : lang === 'en' ? 'Remove' : "O'chirish"}
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
                              : (lang === 'ru' ? `Вариант ${String.fromCharCode(65 + optIdx)}` : lang === 'en' ? `Option ${String.fromCharCode(65 + optIdx)}` : `${String.fromCharCode(65 + optIdx)} variant`)}
                            required
                            className="flex-1"
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

          {/* Submit */}
          <div className="pt-1">
            <AdminBtn
              type="submit"
              variant="blue"
              size="lg"
              loading={submitting}
              icon={<PlusIcon size={16} />}
              disabled={method === 'bank' && bankCategories.length === 0}
              className="w-full sm:w-auto"
            >
              {t.createExam}
            </AdminBtn>
          </div>
        </form>
      </div>
    </AdminCard>
  );
}
