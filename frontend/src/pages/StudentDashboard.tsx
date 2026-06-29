import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Card, CardContent, CardHeader, CardTitle, Button } from '../components/ui';
import { translations, Language } from '../i18n';
import { InstituteLogo } from '../components/InstituteLogo';
import { ExamResultSummary, type ExamResultPayload } from '../components/ExamResultSummary';
import { readJsonSafe } from '../lib/http';
import { apiUrl } from '../lib/apiUrl';
import { formatCountdown, formatExamDateTime, msUntil } from '../lib/datetimeLocal';

export function StudentDashboard({
  token,
  user,
  onStartExam,
  lang,
}: {
  token: string;
  user?: { group_id?: number | null; group_name?: string | null };
  onStartExam: (exam: any, studentExamId: number) => void;
  lang: Language;
}) {
  const [exams, setExams] = useState([]);
  const [results, setResults] = useState([]);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'available' | 'results'>('available');
  const [isBanned, setIsBanned] = useState(false);
  const [detailPayload, setDetailPayload] = useState<ExamResultPayload | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [clockSkewMs, setClockSkewMs] = useState(0);
  const [tick, setTick] = useState(0);
  const t = translations[lang];

  const nowMs = () => Date.now() + clockSkewMs;

  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const loadExams = async (cancelled: { v: boolean }) => {
    const tr = translations[lang];
    const looksLikeBannedMessage = (err: string) => {
      const low = err.toLowerCase();
      return (
        low.includes('banned') ||
        low.includes('blocked') ||
        low.includes('заблок') ||
        low.includes('bloklangan')
      );
    };

    const handleStudentListRes = async (res: Response) => {
      if (cancelled.v) return;
      if (res.status === 401) {
        setError(tr.studentSessionUnauthorized);
        return;
      }
      if (res.status === 403) {
        const j = await readJsonSafe<{ error?: string }>(res);
        const err = String(j?.error || '');
        if (looksLikeBannedMessage(err)) {
          setIsBanned(true);
          return;
        }
        setError(tr.studentDashboardApi403Body);
      }
    };

    const examsRes = await fetch(apiUrl('/api/student/exams'), {
      headers: { Authorization: `Bearer ${token}` },
    });
    const dateHdr = examsRes.headers.get('Date');
    if (dateHdr) {
      const serverMs = new Date(dateHdr).getTime();
      if (!Number.isNaN(serverMs)) {
        setClockSkewMs(serverMs - Date.now());
      }
    }
    await handleStudentListRes(examsRes);
    if (cancelled.v) return;
    if (examsRes.ok) {
      const j = await readJsonSafe<any[]>(examsRes);
      if (!cancelled.v) setExams(Array.isArray(j) ? j : []);
    }
    if (cancelled.v) return;
    const resultsRes = await fetch(apiUrl('/api/student/results'), {
      headers: { Authorization: `Bearer ${token}` },
    });
    await handleStudentListRes(resultsRes);
    if (cancelled.v) return;
    if (resultsRes.ok) {
      const j = await readJsonSafe<any[]>(resultsRes);
      if (!cancelled.v) setResults(Array.isArray(j) ? j : []);
    }
  };

  useEffect(() => {
    const cancelled = { v: false };
    setError('');
    void loadExams(cancelled);
    const refreshId = window.setInterval(() => {
      void loadExams(cancelled);
    }, 30_000);
    return () => {
      cancelled.v = true;
      clearInterval(refreshId);
    };
  }, [token, lang]);

  const startExam = (exam: any) => {
    onStartExam(exam, 0); // 0 is a placeholder, will be set in PreExamCheck
  };

  const container = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: { staggerChildren: 0.1 }
    }
  };

  const item: any = {
    hidden: { opacity: 0, y: 20 },
    show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 300, damping: 24 } }
  };

  if (isBanned) {
    return (
      <div className="p-2 sm:p-6 max-w-7xl mx-auto flex items-center justify-center min-h-[60vh]">
        <Card className="max-w-md w-full border-red-200 bg-red-50/50">
          <CardContent className="pt-6 text-center">
            <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
            </div>
            <h2 className="text-2xl font-bold text-red-700 mb-2">{t.studentAccountBannedTitle}</h2>
            <p className="text-red-600/80">{t.studentAccountBannedBody}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const openResultDetail = async (examId: number) => {
    setDetailLoading(true);
    try {
      const res = await fetch(apiUrl(`/api/student/exams/${examId}/result-details`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const j = await readJsonSafe<ExamResultPayload>(res);
      if (!j?.result_public_id) return;
      setDetailPayload({
        exam_id: examId,
        result_public_id: j.result_public_id,
        verify_url: j.verify_url,
        overview: j.overview,
        questions: j.questions,
        score: j.score,
        total: j.total,
        integrity_code: j.integrity_code,
        percentage: j.percentage,
        completed_at: j.completed_at,
        exam_title: j.exam_title,
        student_name: j.student_name,
      });
    } finally {
      setDetailLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto relative">
      {detailPayload && (
        <div className="fixed inset-0 z-[100] flex flex-col overflow-y-auto overscroll-y-contain bg-slate-900/50 backdrop-blur-sm px-3 py-[max(0.75rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="flex-1 min-h-0 w-full max-w-4xl mx-auto py-2">
            <ExamResultSummary
              data={detailPayload}
              token={token}
              lang={lang}
              onBack={() => setDetailPayload(null)}
            />
          </div>
        </div>
      )}
      <div className="flex flex-col md:flex-row items-center justify-between mb-8 gap-4">
        <div className="flex items-center gap-3">
          <InstituteLogo size="sm" className="shrink-0" />
          <div>
            <h2 className="text-3xl font-bold tracking-tight text-gray-900">{t.exams}</h2>
            {user?.group_name && (
              <p className="text-sm text-gray-500 mt-0.5">
                {t.studentYourGroup}: <span className="font-medium text-gray-700">{user.group_name}</span>
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-col items-center md:items-end gap-2">
        <div className="bg-gray-100 p-1 rounded-lg flex gap-1 border border-gray-200">
          <button
            onClick={() => setActiveTab('available')}
            className={`px-5 py-1.5 rounded-md text-sm font-medium transition-colors ${activeTab === 'available' ? 'bg-white text-gray-900 shadow-sm border border-gray-200' : 'text-gray-500 hover:text-gray-800'}`}
          >
            {t.tabAvailableExams}
          </button>
          <button
            onClick={() => setActiveTab('results')}
            className={`px-5 py-1.5 rounded-md text-sm font-medium transition-colors ${activeTab === 'results' ? 'bg-white text-gray-900 shadow-sm border border-gray-200' : 'text-gray-500 hover:text-gray-800'}`}
          >
            {t.tabMyResults}
          </button>
        </div>
        <p className="text-[11px] text-gray-500 tabular-nums text-center md:text-right">
          {t.examCurrentTime}: {formatExamDateTime(new Date(nowMs()).toISOString(), lang)}
        </p>
        </div>
      </div>

      {error && (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="bg-red-50 border border-red-100 text-red-700 text-sm font-medium p-3.5 rounded-lg mb-8">
          {error}
        </motion.div>
      )}
      
      <AnimatePresence mode="wait">
        {activeTab === 'available' ? (
          <motion.div key="available" variants={container} initial="hidden" animate="show" exit={{ opacity: 0, y: -20 }} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
            {exams.map((e: any) => {
              void tick;
              const now = nowMs();
              const startMs = new Date(e.start_time).getTime();
              const endMs = new Date(e.end_time).getTime();
              const isOngoing = now >= startMs && now <= endMs;
              const isUpcoming = now < startMs;
              const isPast = now > endMs;
              const untilStart = msUntil(e.start_time, now);

              return (
                <motion.div variants={item} key={e.id}>
                  <Card className={`transition-colors hover:border-gray-300 ${isPast ? 'opacity-60' : ''}`}>
                    <div className="p-5">
                      {/* Sarlavha */}
                      <div className="flex items-start justify-between gap-3 mb-4">
                        <h3 className="text-[15.5px] font-semibold text-gray-900 leading-snug min-w-0">{e.title}</h3>
                        <span className="shrink-0 text-[10px] font-semibold bg-gray-100 text-gray-500 px-2 py-0.5 rounded-md uppercase tracking-wide">
                          {e.language}
                        </span>
                      </div>

                      {/* Ma'lumot qatorlari */}
                      <dl className="space-y-2 text-[13px]">
                        <div className="flex items-center justify-between gap-3">
                          <dt className="text-gray-600 font-medium">{t.startTime}</dt>
                          <dd className="font-semibold text-gray-900 tabular-nums text-right">{formatExamDateTime(e.start_time, lang)}</dd>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <dt className="text-gray-600 font-medium">{t.endTime}</dt>
                          <dd className="font-semibold text-gray-900 tabular-nums text-right">{formatExamDateTime(e.end_time, lang)}</dd>
                        </div>
                        <div className="flex items-center justify-between gap-3 pt-2.5 border-t border-gray-100">
                          <dt className="text-gray-600 font-medium">{t.duration}</dt>
                          <dd>
                            <span className="font-semibold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-md text-[12px] tabular-nums">
                              {e.duration_minutes} {t.minutesShort}
                            </span>
                          </dd>
                        </div>
                        {e.exam_mode === 'bank_mixed' && e.bank_question_count ? (
                          <div className="flex items-center justify-between gap-3">
                            <dt className="text-gray-600 font-medium">{t.examBankQuestionCount}</dt>
                            <dd className="font-semibold text-gray-900 tabular-nums">{e.bank_question_count}</dd>
                          </div>
                        ) : null}
                      </dl>

                      {/* Belgilar (kutilmoqda / PIN) */}
                      {((isUpcoming && untilStart > 0) || e.has_pin) && (
                        <div className="mt-3 flex flex-col gap-2">
                          {isUpcoming && untilStart > 0 && (
                            <div className="text-[12px] text-amber-700 bg-amber-50 border border-amber-100 rounded-md px-2.5 py-1.5">
                              {t.examStartsIn}: <strong className="tabular-nums">{formatCountdown(untilStart, lang)}</strong>
                            </div>
                          )}
                          {e.has_pin && (
                            <div className="inline-flex items-center gap-1.5 text-[12px] font-medium text-amber-700">
                              <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                              {t.examPinRequiredBadge}
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Tugma */}
                    <div className="px-5 pb-5 pt-1">
                      {isOngoing ? (
                        <Button className="w-full" onClick={() => startExam(e)}>{t.takeExam}</Button>
                      ) : isUpcoming ? (
                        <Button className="w-full" variant="secondary" disabled>
                          {t.examStateUpcoming}
                          {untilStart > 0 ? ` · ${formatCountdown(untilStart, lang)}` : ''}
                        </Button>
                      ) : (
                        <Button className="w-full" variant="secondary" disabled>
                          {t.examStateEnded}
                        </Button>
                      )}
                    </div>
                  </Card>
                </motion.div>
              );
            })}
            {exams.length === 0 && (
              <div className="col-span-full text-center py-16 bg-white border border-gray-200 rounded-lg px-6">
                <div className="w-14 h-14 bg-gray-50 border border-gray-100 rounded-lg flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" /></svg>
                </div>
                <p className="text-gray-500 font-medium text-lg">{t.emptyStudentExams}</p>
                <p className="text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-2xl px-4 py-3 mt-4 max-w-lg mx-auto">
                  {!user?.group_id
                    ? t.studentNoGroupHint
                    : t.studentNoExamsForGroupHint.replace('{group}', user.group_name || String(user.group_id))}
                </p>
              </div>
            )}
          </motion.div>
        ) : (
          <motion.div key="results" variants={container} initial="hidden" animate="show" exit={{ opacity: 0, y: -20 }} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {results.map((r: any) => (
              <motion.div variants={item} key={r.id}>
                <Card className="h-full flex flex-col overflow-hidden transition-colors hover:border-gray-300">
                  <CardHeader className="border-b border-gray-100">
                    <CardTitle className="text-xl font-semibold text-gray-800">{r.title}</CardTitle>
                  </CardHeader>
                  <CardContent className="flex-1 flex flex-col p-6 space-y-4">
                    <div className="flex justify-between items-center bg-gray-50 border border-gray-100 p-3.5 rounded-lg">
                      <span className="text-gray-600 font-medium">{t.resultScore}</span>
                      <span className={`text-2xl font-bold ${(r.percentage ?? 0) >= 50 ? 'text-green-600' : 'text-red-600'}`}>
                        {r.percentage != null ? `${r.percentage}%` : r.score != null ? `${r.score}` : t.resultPending}
                        {r.total_questions > 0 && r.percentage != null && (
                          <span className="block text-xs font-normal text-gray-500">
                            ({r.score}/{r.total_questions})
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="flex justify-between items-center bg-gray-50 border border-gray-100 p-3.5 rounded-lg">
                      <span className="text-gray-600 font-medium">{t.resultStatus}</span>
                      <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
                        r.status === 'Completed' ? 'bg-green-100 text-green-700' :
                        r.status === 'Banned' ? 'bg-red-100 text-red-700' :
                        'bg-yellow-100 text-yellow-700'
                      }`}>
                        {r.status === 'Completed'
                          ? t.resultStatusCompleted
                          : r.status === 'Banned'
                            ? t.resultStatusBanned
                            : t.resultStatusOther}
                      </span>
                    </div>
                    {r.completed_at && (
                      <div className="text-xs text-gray-500 text-center pt-2">
                        {t.resultCompletedLabel}: {new Date(r.completed_at).toLocaleString()}
                      </div>
                    )}
                    {r.status === 'Completed' && r.result_public_id && (
                      <Button
                        className="w-full mt-2"
                        variant="outline"
                        disabled={detailLoading}
                        onClick={() => openResultDetail(r.exam_id)}
                      >
                        {t.studentResultCertificateBtn}
                      </Button>
                    )}
                  </CardContent>
                </Card>
              </motion.div>
            ))}
            {results.length === 0 && (
              <div className="col-span-full text-center py-16 bg-white border border-gray-200 rounded-lg">
                <div className="w-14 h-14 bg-gray-50 border border-gray-100 rounded-lg flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                </div>
                <p className="text-gray-500 font-medium text-lg">{t.emptyStudentResults}</p>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
