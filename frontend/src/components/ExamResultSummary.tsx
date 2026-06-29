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

  return (
    <div className="w-full max-w-4xl mx-auto min-h-0 px-2 sm:px-4 py-4 sm:py-6 md:py-8 space-y-5 sm:space-y-7 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className={`relative overflow-hidden rounded-xl border ${
          passed
            ? 'border-emerald-200 bg-emerald-50/50'
            : 'border-red-200 bg-red-50/50'
        }`}
      >
        <div className="relative p-5 sm:p-8 md:p-10">
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
            <div className="flex flex-col items-center gap-2 bg-white rounded-lg p-3 sm:p-4 border border-slate-200/70 shadow-sm shrink-0 mx-auto sm:mx-0">
              <QRCodeSVG value={data.verify_url} size={96} level="M" includeMargin={false} />
              <span className="text-[10px] text-slate-500 text-center">{t.resultQrHint}</span>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-lg bg-white border border-slate-200/80 p-4">
              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">{t.resultIdLabel}</p>
              <p className="text-sm sm:text-base font-bold text-indigo-900 font-mono mt-1 break-all">{data.result_public_id}</p>
            </div>
            <div className="rounded-lg bg-white border border-slate-200/80 p-4">
              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">{t.resultScore}</p>
              <p className="text-2xl font-bold text-slate-900 mt-1">
                {data.score} / {data.total}{' '}
                <span className={`text-base font-semibold ${passed ? 'text-emerald-700' : 'text-red-600'}`}>({pct}%)</span>
              </p>
            </div>
            <div className="rounded-lg bg-white border border-slate-200/80 p-4">
              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">{t.resultIntegrityLabel}</p>
              <p className="text-xs font-mono font-semibold text-slate-800 mt-1 break-all leading-relaxed">{data.integrity_code}</p>
            </div>
          </div>

          {data.completed_at && (
            <p className="text-xs text-slate-500 mt-4">
              {t.resultCompletedLabel}: {new Date(data.completed_at).toLocaleString()}
            </p>
          )}

          <div className="mt-5 flex flex-col sm:flex-row gap-2 sm:gap-3">
            <Button className="rounded-full w-full sm:w-auto" onClick={downloadPdf} disabled={pdfBusy}>
              {pdfBusy ? t.resultDownloading : t.resultDownloadPdf}
            </Button>
            {onBack && (
              <Button variant="outline" className="rounded-full w-full sm:w-auto" onClick={onBack}>
                {t.studentDash}
              </Button>
            )}
          </div>
        </div>
      </motion.div>

      {data.overview?.trim() && (
        <div className="rounded-lg border border-slate-200/80 bg-white p-5 sm:p-6 shadow-sm">
          <h2 className="text-lg font-bold text-slate-900 mb-2">{t.resultAiSummaryTitle}</h2>
          <p className="text-slate-700 leading-relaxed text-sm sm:text-[15px]">{data.overview}</p>
        </div>
      )}

      <div className="space-y-3 sm:space-y-4">
        <h2 className="text-lg sm:text-xl font-bold text-slate-900 px-1">{t.resultByQuestions}</h2>
        {data.questions.map((q, i) => (
          <motion.div
            key={q.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.02 }}
            className={`rounded-lg border-2 overflow-hidden ${
              q.isCorrect ? 'border-emerald-200 bg-emerald-50/50' : 'border-red-200 bg-red-50/40'
            }`}
          >
            <div className="px-4 sm:px-5 py-4 border-b border-black/5 flex items-start gap-2">
              <span className="text-slate-400 font-medium shrink-0">{i + 1}.</span>
              <p className="text-sm sm:text-[15px] font-semibold text-slate-900 flex-1 leading-relaxed">
                {cleanQuestionPrompt(q.text)}
              </p>
              <span
                className={`shrink-0 text-[10px] font-bold uppercase px-2.5 py-1 rounded-full ${
                  q.isCorrect ? 'bg-emerald-200 text-emerald-900' : 'bg-red-200 text-red-900'
                }`}
              >
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
                <p className="text-emerald-900/90 leading-relaxed">{q.commentCorrect}</p>
              )}
              {!q.isCorrect && q.whyStudentWrong && (
                <p className="text-red-900/90 leading-relaxed">
                  <span className="font-semibold">{t.resultWhyWrong}: </span>
                  {q.whyStudentWrong}
                </p>
              )}
              {!q.isCorrect && q.whyCorrectIsRight && (
                <p className="text-emerald-900/90 leading-relaxed">
                  <span className="font-semibold">{t.resultWhyCorrectExplain}: </span>
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
