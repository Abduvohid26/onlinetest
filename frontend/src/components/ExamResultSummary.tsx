import React, { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { motion } from 'motion/react';
import { Button } from './ui';
import { InstituteLogo } from './InstituteLogo';
import { apiUrl } from '../lib/apiUrl';
import { translations, Language } from '../i18n';
import { cleanQuestionPrompt } from '../lib/examQuestionUtils';

export type ResultQuestionRow = {
  id: number;
  text: string;
  options?: string[];
  studentAnswer: string | null;
  correctAnswer: string;
  isCorrect: boolean;
  commentCorrect: string;
  whyStudentWrong: string;
  whyCorrectIsRight: string;
};

export type ExamResultPayload = {
  exam_id?: number;
  result_public_id: string;
  verify_url: string;
  overview: string;
  questions: ResultQuestionRow[];
  score: number;
  total: number;
  integrity_code: string;
  percentage?: number;
  completed_at?: string;
  exam_title?: string;
  student_name?: string;
};

type Props = {
  data: ExamResultPayload;
  token?: string | null;
  lang?: Language;
  publicPdfUrl?: string | null;
  onBack?: () => void;
};

export function ExamResultSummary({ data, token, lang = 'uz', publicPdfUrl, onBack }: Props) {
  const [pdfBusy, setPdfBusy] = useState(false);
  const t = translations[lang];

  const downloadPdf = async () => {
    setPdfBusy(true);
    try {
      let url: string;
      const headers: HeadersInit = {};
      if (publicPdfUrl) {
        url = publicPdfUrl.startsWith('http') ? publicPdfUrl : publicPdfUrl;
      } else if (token && data.exam_id != null) {
        url = apiUrl(`/api/student/exams/${data.exam_id}/certificate.pdf`);
        headers.Authorization = `Bearer ${token}`;
      } else {
        return;
      }
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error('PDF');
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = `${data.result_public_id}.pdf`;
      a.click();
      URL.revokeObjectURL(href);
    } catch (e) {
      console.error(e);
      alert(t.resultPdfError);
    } finally {
      setPdfBusy(false);
    }
  };

  const pct = data.percentage ?? (data.total > 0 ? Math.round((data.score / data.total) * 100) : 0);
  const passed = pct >= 50;
  const RES_L = {
    uz: { passed: 'O‘tdi', failed: 'O‘tmadi' },
    ru: { passed: 'Сдал', failed: 'Не сдал' },
    en: { passed: 'Passed', failed: 'Failed' },
  }[lang];

  // Ball halqasi (SVG) — r=16, aylana ≈ 100.53
  const ringDash = `${Math.max(0, Math.min(100, pct)) * 1.0053} 100.53`;
  const ringColor = passed ? '#059669' : '#dc2626';

  return (
    <div className="w-full max-w-4xl mx-auto min-h-0 px-2 sm:px-4 py-4 sm:py-6 md:py-8 space-y-4 sm:space-y-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm"
      >
        {/* Pass/fail accent bar */}
        <div className={`h-1.5 w-full ${passed ? 'bg-emerald-500' : 'bg-red-500'}`} />
        <div className="p-5 sm:p-8">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-5">
            <div className="flex items-start gap-3 sm:gap-4 min-w-0 flex-1">
              <InstituteLogo size="md" className="shrink-0" />
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-500">
                  Farg‘ona jamoat salomatligi tibbiyot instituti
                </p>
                <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight mt-1">
                  {t.resultPageTitle}
                </h1>
                {data.exam_title && (
                  <p className="text-slate-600 mt-1 font-medium text-sm sm:text-base break-words">{data.exam_title}</p>
                )}
                {data.student_name && (
                  <p className="text-xs sm:text-sm text-slate-500 mt-0.5">{t.userFullName}: {data.student_name}</p>
                )}
              </div>
            </div>
            <div className="flex flex-col items-center gap-2 bg-white rounded-xl p-3 sm:p-4 border border-slate-200 shrink-0 mx-auto sm:mx-0">
              <QRCodeSVG value={data.verify_url} size={96} level="M" includeMargin={false} />
              <span className="text-[10px] text-slate-500 text-center">{t.resultQrHint}</span>
            </div>
          </div>

          {/* Score focal */}
          <div className="mt-6 flex items-center gap-4 sm:gap-5 rounded-xl border border-gray-200 bg-gray-50 p-4 sm:p-5">
            <div className="relative w-20 h-20 shrink-0">
              <svg viewBox="0 0 36 36" className="w-20 h-20 -rotate-90">
                <circle cx="18" cy="18" r="16" fill="none" stroke="#e5e7eb" strokeWidth="3" />
                <circle cx="18" cy="18" r="16" fill="none" stroke={ringColor} strokeWidth="3" strokeDasharray={ringDash} strokeLinecap="round" />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className={`text-[19px] font-bold tabular-nums ${passed ? 'text-emerald-600' : 'text-red-600'}`}>{pct}%</span>
              </div>
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[13px] font-semibold text-slate-500 uppercase tracking-wide">{t.resultScore}</span>
                <span className={`text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-md ${passed ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                  {passed ? RES_L.passed : RES_L.failed}
                </span>
              </div>
              <p className="text-2xl sm:text-3xl font-bold text-slate-900 tabular-nums mt-1">
                {data.score} <span className="text-slate-400 font-semibold text-xl">/ {data.total}</span>
              </p>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-xl bg-gray-50 border border-gray-200 p-4">
              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">{t.resultIdLabel}</p>
              <p className="text-sm font-bold text-indigo-900 font-mono mt-1 break-all">{data.result_public_id}</p>
            </div>
            <div className="rounded-xl bg-gray-50 border border-gray-200 p-4">
              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">{t.resultIntegrityLabel}</p>
              <p className="text-xs font-mono font-semibold text-slate-800 mt-1 break-all leading-relaxed">{data.integrity_code}</p>
            </div>
            <div className="rounded-xl bg-gray-50 border border-gray-200 p-4">
              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">{t.resultCompletedLabel}</p>
              <p className="text-sm font-semibold text-slate-800 mt-1 tabular-nums">
                {data.completed_at ? new Date(data.completed_at).toLocaleString() : '—'}
              </p>
            </div>
          </div>

          <div className="mt-5 flex flex-col sm:flex-row gap-2 sm:gap-3">
            <Button className="w-full sm:w-auto" onClick={downloadPdf} disabled={pdfBusy}>
              {pdfBusy ? t.resultDownloading : t.resultDownloadPdf}
            </Button>
            {onBack && (
              <Button variant="outline" className="w-full sm:w-auto" onClick={onBack}>
                {t.studentDash}
              </Button>
            )}
          </div>
        </div>
      </motion.div>

      {data.overview?.trim() && (
        <div className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6">
          <h2 className="text-[15px] font-bold text-slate-900 mb-2 flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.9} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
            </span>
            {t.resultAiSummaryTitle}
          </h2>
          <p className="text-slate-700 leading-relaxed text-sm sm:text-[15px]">{data.overview}</p>
        </div>
      )}

      <div className="space-y-3">
        <h2 className="text-[16px] sm:text-[17px] font-bold text-slate-900 px-1">{t.resultByQuestions}</h2>
        {data.questions.map((q, i) => (
          <motion.div
            key={q.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.02 }}
            className={`rounded-xl border overflow-hidden bg-white ${q.isCorrect ? 'border-emerald-200' : 'border-red-200'}`}
          >
            <div className={`px-4 sm:px-5 py-3.5 border-b flex items-start gap-3 ${q.isCorrect ? 'bg-emerald-50/60 border-emerald-100' : 'bg-red-50/60 border-red-100'}`}>
              <span className={`shrink-0 mt-0.5 w-6 h-6 rounded-full flex items-center justify-center text-white ${q.isCorrect ? 'bg-emerald-500' : 'bg-red-500'}`}>
                {q.isCorrect ? (
                  <svg className="w-3.5 h-3.5 stroke-[3]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                ) : (
                  <svg className="w-3.5 h-3.5 stroke-[3]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                )}
              </span>
              <p className="text-sm sm:text-[15px] font-semibold text-slate-900 flex-1 leading-relaxed">
                <span className="text-slate-400 mr-1.5">{i + 1}.</span>
                {cleanQuestionPrompt(q.text)}
              </p>
              <span className={`shrink-0 text-[10px] font-bold uppercase px-2.5 py-1 rounded-md ${q.isCorrect ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                {q.isCorrect ? t.resultCorrectBadge : t.resultWrongBadge}
              </span>
            </div>
            <div className="px-4 sm:px-5 py-4 space-y-2 text-sm">
              <p className="text-slate-700">
                <span className="font-semibold text-slate-900">{t.resultYourAnswer}:</span>{' '}
                {q.studentAnswer || '—'}
              </p>
              {!q.isCorrect && (
                <p className="text-emerald-800 font-medium">
                  {t.resultCorrectAnswerLabel}: {q.correctAnswer}
                </p>
              )}
              {q.isCorrect && q.commentCorrect && (
                <p className="text-slate-600 leading-relaxed">{q.commentCorrect}</p>
              )}
              {!q.isCorrect && q.whyStudentWrong && (
                <p className="text-slate-600 leading-relaxed">
                  <span className="font-semibold text-slate-800">{t.resultWhyWrong}: </span>
                  {q.whyStudentWrong}
                </p>
              )}
              {!q.isCorrect && q.whyCorrectIsRight && (
                <p className="text-slate-600 leading-relaxed">
                  <span className="font-semibold text-slate-800">{t.resultWhyCorrectExplain}: </span>
                  {q.whyCorrectIsRight}
                </p>
              )}
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
