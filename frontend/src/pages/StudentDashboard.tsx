import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { translations, Language } from '../i18n';
import { ExamResultSummary, type ExamResultPayload } from '../components/ExamResultSummary';
import { readJsonSafe } from '../lib/http';
import { apiUrl } from '../lib/apiUrl';
import { formatCountdown, formatExamDateTime, msUntil } from '../lib/datetimeLocal';
import { AdminBtn, AdminAlert } from './admin/ui';

const REFRESH_INTERVAL_MS = 30_000;

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
  const [exams, setExams] = useState<any[]>([]);
  const [results, setResults] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<'available' | 'results'>('available');
  const [isBanned, setIsBanned] = useState(false);
  const [detailPayload, setDetailPayload] = useState<ExamResultPayload | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [pdfDownloadingId, setPdfDownloadingId] = useState<number | null>(null);
  const [clockSkewMs, setClockSkewMs] = useState(0);
  const [tick, setTick] = useState(0);
  const t = translations[lang];
  const cancelledRef = useRef(false);

  const nowMs = () => Date.now() + clockSkewMs;

  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const looksLikeBannedMessage = (err: string) => {
    const low = err.toLowerCase();
    return low.includes('banned') || low.includes('blocked') || low.includes('заблок') || low.includes('bloklangan');
  };

  const fetchData = useCallback(async (isManual = false) => {
    const tr = translations[lang];
    if (isManual) setRefreshing(true);

    const examsRes = await fetch(apiUrl('/api/student/exams'), {
      headers: { Authorization: `Bearer ${token}` },
    });

    const dateHdr = examsRes.headers.get('Date');
    if (dateHdr) {
      const serverMs = new Date(dateHdr).getTime();
      if (!Number.isNaN(serverMs)) setClockSkewMs(serverMs - Date.now());
    }

    if (cancelledRef.current) return;
    if (examsRes.status === 401) { setError(tr.studentSessionUnauthorized); setLoading(false); setRefreshing(false); return; }
    if (examsRes.status === 403) {
      const j = await readJsonSafe<{ error?: string }>(examsRes);
      const err = String(j?.error || '');
      if (looksLikeBannedMessage(err)) { setIsBanned(true); setLoading(false); setRefreshing(false); return; }
      setError(tr.studentDashboardApi403Body);
      setLoading(false); setRefreshing(false); return;
    }
    if (examsRes.ok) {
      const j = await readJsonSafe<any[]>(examsRes);
      if (!cancelledRef.current) setExams(Array.isArray(j) ? j : []);
    }

    if (cancelledRef.current) return;
    const resultsRes = await fetch(apiUrl('/api/student/results'), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (resultsRes.ok) {
      const j = await readJsonSafe<any[]>(resultsRes);
      if (!cancelledRef.current) setResults(Array.isArray(j) ? j : []);
    }

    if (!cancelledRef.current) {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token, lang]);

  useEffect(() => {
    cancelledRef.current = false;
    setLoading(true);
    setError('');
    void fetchData();
    const id = window.setInterval(() => void fetchData(), REFRESH_INTERVAL_MS);
    return () => { cancelledRef.current = true; clearInterval(id); };
  }, [fetchData]);

  const handleManualReload = () => {
    if (refreshing) return;
    void fetchData(true);
  };

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

  /** "Batafsil" oynasini ochmasdan to'g'ridan-to'g'ri sertifikat PDF yuklab olish. */
  const downloadCertificate = async (examId: number, resultId: string) => {
    setPdfDownloadingId(examId);
    try {
      const res = await fetch(apiUrl(`/api/student/exams/${examId}/certificate.pdf`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('PDF');
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = `${resultId}.pdf`;
      a.click();
      URL.revokeObjectURL(href);
    } catch (e) {
      console.error(e);
      alert(t.resultPdfError);
    } finally {
      setPdfDownloadingId(null);
    }
  };

  if (isBanned) {
    return (
      <div className="px-3 sm:px-6 py-8 max-w-lg mx-auto">
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center">
          <div className="w-14 h-14 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
          </div>
          <h2 className="text-[17px] font-bold text-red-700 mb-1">{t.studentAccountBannedTitle}</h2>
          <p className="text-[14px] text-red-600/80">{t.studentAccountBannedBody}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="px-3 sm:px-6 py-4 sm:py-6 max-w-5xl mx-auto relative">
      {/* Result detail overlay — createPortal orqali document.body ga chiqariladi.
          Sabab: App.tsx dagi animatsiyalangan motion.div (framer-motion "filter"/"transform"
          qo'yadi) "fixed" pozitsiyani haqiqiy ekran o'rniga o'sha konteynerga nisbatan
          hisoblab qo'yardi — overlay sahifa boshidan emas, joriy scroll holatidan
          boshlanib qolardi va yopish tugmasi noto'g'ri joyda ko'rinardi. */}
      {detailPayload && createPortal(
        <div className="fixed inset-0 z-[100] flex flex-col overflow-y-auto overscroll-y-contain bg-slate-900/50 backdrop-blur-sm px-3 py-[max(0.75rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]">
          {/* Har doim ko'rinadigan yopish tugmasi — ichkarida scroll qancha uzun bo'lishidan
              qat'iy nazar, "qaytish" imkoni doim qo'lda bo'lsin. */}
          <button
            type="button"
            onClick={() => setDetailPayload(null)}
            aria-label={t.studentDash}
            className="fixed top-[max(0.75rem,env(safe-area-inset-top))] right-3 z-[110] w-9 h-9 rounded-full bg-white shadow-lg border border-gray-200 text-gray-600 hover:bg-gray-50 hover:text-gray-900 flex items-center justify-center transition-colors"
          >
            <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
          <div className="flex-1 min-h-0 w-full max-w-4xl mx-auto py-2">
            <ExamResultSummary
              data={detailPayload}
              token={token}
              lang={lang}
              onBack={() => setDetailPayload(null)}
            />
          </div>
        </div>,
        document.body,
      )}

      {/* ── Header ── */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        {/* Tabs */}
        <div className="flex items-center h-9 rounded-lg bg-gray-100 p-0.5 border border-gray-200">
          <button
            onClick={() => setActiveTab('available')}
            className={`h-full px-4 rounded-md text-[13px] font-semibold transition-colors ${activeTab === 'available' ? 'bg-white text-gray-900 shadow-sm border border-gray-200' : 'text-gray-500 hover:text-gray-800'}`}
          >
            {t.tabAvailableExams}
          </button>
          <button
            onClick={() => setActiveTab('results')}
            className={`h-full px-4 rounded-md text-[13px] font-semibold transition-colors ${activeTab === 'results' ? 'bg-white text-gray-900 shadow-sm border border-gray-200' : 'text-gray-500 hover:text-gray-800'}`}
          >
            {t.tabMyResults}
          </button>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Current time */}
        <p className="text-[12px] text-gray-400 tabular-nums hidden sm:block">
          {t.examCurrentTime}: {formatExamDateTime(new Date(nowMs()).toISOString(), lang)}
        </p>

        {/* Reload */}
        <AdminBtn
          variant="ghost"
          size="sm"
          loading={refreshing}
          onClick={handleManualReload}
          icon={
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          }
        >
          <span className="hidden sm:inline">{t.reload ?? 'Yangilash'}</span>
        </AdminBtn>
      </div>

      {/* Error */}
      <AnimatePresence>
        {error && (
          <motion.div key="err" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden mb-4">
            <AdminAlert type="error">{error}</AdminAlert>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Loading skeleton */}
      {loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-lg border border-gray-200 bg-white p-5 space-y-3 animate-pulse">
              <div className="h-4 bg-gray-100 rounded w-3/4" />
              <div className="h-3 bg-gray-100 rounded w-1/2" />
              <div className="h-3 bg-gray-100 rounded w-2/3" />
              <div className="h-9 bg-gray-100 rounded mt-4" />
            </div>
          ))}
        </div>
      )}

      {/* Content */}
      {!loading && (
        <AnimatePresence mode="wait">
          {activeTab === 'available' ? (
            <motion.div
              key="available"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2 }}
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3"
            >
              {(() => {
                void tick;
                const now = nowMs();
                // Talaba ro'yxatida faqat hali TUGAMAGAN imtihonlar ko'rinadi — "Tugagan"
                // kartalar olib tashlanadi, lekin hali boshlanmagan (istalgan vaqt masofasidagi)
                // imtihonlar ham countdown bilan ko'rinishda qoladi.
                const visibleExams = exams.filter((e: any) => {
                  const endMs = new Date(e.end_time).getTime();
                  return now <= endMs;
                });

                if (exams.length === 0) {
                  return (
                    <div className="col-span-full">
                      <div className="rounded-lg border border-gray-200 bg-white py-14 px-6 text-center">
                        <div className="w-12 h-12 bg-gray-50 border border-gray-100 rounded-lg flex items-center justify-center mx-auto mb-3 text-gray-400">
                          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                          </svg>
                        </div>
                        <p className="text-[14px] font-medium text-gray-600 mb-1">{t.emptyStudentExams}</p>
                        <p className="text-[13px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-4 py-3 mt-3 max-w-md mx-auto">
                          {!user?.group_id
                            ? t.studentNoGroupHint
                            : t.studentNoExamsForGroupHint.replace('{group}', user.group_name || String(user.group_id))}
                        </p>
                      </div>
                    </div>
                  );
                }

                if (visibleExams.length === 0) {
                  return (
                    <div className="col-span-full">
                      <div className="rounded-lg border border-gray-200 bg-white py-14 px-6 text-center">
                        <div className="w-12 h-12 bg-gray-50 border border-gray-100 rounded-lg flex items-center justify-center mx-auto mb-3 text-gray-400">
                          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        </div>
                        <p className="text-[14px] font-medium text-gray-600 mb-1">{t.studentNoOpenExamsTitle}</p>
                        <p className="text-[13px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-4 py-3 mt-3 max-w-md mx-auto">
                          {t.studentNoOpenExamsHint}
                        </p>
                      </div>
                    </div>
                  );
                }

                return visibleExams.map((e: any, i) => {
                const startMs = new Date(e.start_time).getTime();
                const endMs = new Date(e.end_time).getTime();
                const isOngoing = now >= startMs && now <= endMs;
                const isUpcoming = now < startMs;
                const untilStart = msUntil(e.start_time, now);

                return (
                  <motion.div
                    key={e.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.04 }}
                    className="rounded-lg border border-gray-200 bg-white overflow-hidden transition-colors hover:border-gray-300"
                  >
                    <div className="p-4 sm:p-5">
                      {/* Title row */}
                      <div className="flex items-start justify-between gap-2 mb-4">
                        <h3 className="text-[14.5px] font-semibold text-gray-900 leading-snug min-w-0">{e.title}</h3>
                        <span className="shrink-0 text-[10px] font-semibold bg-gray-100 text-gray-500 px-2 py-0.5 rounded-md uppercase tracking-wide">
                          {e.language}
                        </span>
                      </div>

                      {/* Info rows */}
                      <dl className="space-y-2 text-[13px]">
                        <div className="flex items-center justify-between gap-2">
                          <dt className="text-gray-500">{t.startTime}</dt>
                          <dd className="font-medium text-gray-900 tabular-nums text-right">{formatExamDateTime(e.start_time, lang)}</dd>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <dt className="text-gray-500">{t.endTime}</dt>
                          <dd className="font-medium text-gray-900 tabular-nums text-right">{formatExamDateTime(e.end_time, lang)}</dd>
                        </div>
                        <div className="flex items-center justify-between gap-2 pt-2 border-t border-gray-100">
                          <dt className="text-gray-500">{t.duration}</dt>
                          <dd>
                            <span className="font-semibold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-md text-[12px] tabular-nums">
                              {e.duration_minutes} {t.minutesShort}
                            </span>
                          </dd>
                        </div>
                        {e.exam_mode === 'bank_mixed' && e.bank_question_count ? (
                          <div className="flex items-center justify-between gap-2">
                            <dt className="text-gray-500">{t.examBankQuestionCount}</dt>
                            <dd className="font-medium text-gray-900 tabular-nums">{e.bank_question_count}</dd>
                          </div>
                        ) : null}
                      </dl>

                      {/* Badges */}
                      {((isUpcoming && untilStart > 0) || e.has_pin) && (
                        <div className="mt-3 space-y-1.5">
                          {isUpcoming && untilStart > 0 && (
                            <div className="text-[12px] text-amber-700 bg-amber-50 border border-amber-100 rounded-md px-2.5 py-1.5">
                              {t.examStartsIn}: <strong className="tabular-nums">{formatCountdown(untilStart, lang)}</strong>
                            </div>
                          )}
                          {e.has_pin && (
                            <div className="inline-flex items-center gap-1.5 text-[12px] font-medium text-amber-700">
                              <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                              </svg>
                              {t.examPinRequiredBadge}
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Action button */}
                    <div className="px-4 sm:px-5 pb-4 sm:pb-5 pt-0">
                      {isOngoing ? (
                        <AdminBtn variant="blue" size="lg" className="w-full" onClick={() => onStartExam(e, 0)}>
                          {t.takeExam}
                        </AdminBtn>
                      ) : isUpcoming ? (
                        <AdminBtn variant="ghost" size="lg" className="w-full" disabled>
                          {t.examStateUpcoming}{untilStart > 0 ? ` · ${formatCountdown(untilStart, lang)}` : ''}
                        </AdminBtn>
                      ) : (
                        <AdminBtn variant="ghost" size="lg" className="w-full" disabled>
                          {t.examStateEnded}
                        </AdminBtn>
                      )}
                    </div>
                  </motion.div>
                );
                });
              })()}
            </motion.div>
          ) : (
            <motion.div
              key="results"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2 }}
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3"
            >
              {results.length === 0 ? (
                <div className="col-span-full">
                  <div className="rounded-lg border border-gray-200 bg-white py-14 px-6 text-center">
                    <div className="w-12 h-12 bg-gray-50 border border-gray-100 rounded-lg flex items-center justify-center mx-auto mb-3 text-gray-400">
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </div>
                    <p className="text-[14px] font-medium text-gray-600">{t.emptyStudentResults}</p>
                  </div>
                </div>
              ) : results.map((r: any, i) => (
                <motion.div
                  key={r.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                  className="rounded-lg border border-gray-200 bg-white overflow-hidden hover:border-gray-300 transition-colors flex flex-col"
                >
                  <div className="px-4 sm:px-5 py-3.5 border-b border-gray-100">
                    <h3 className="text-[14.5px] font-semibold text-gray-900 leading-snug">{r.title}</h3>
                  </div>
                  <div className="px-4 sm:px-5 py-4 flex-1 space-y-3">
                    {/* Score */}
                    <div className="flex items-center justify-between bg-gray-50 border border-gray-100 rounded-lg px-3.5 py-2.5">
                      <span className="text-[13px] text-gray-500 font-medium">{t.resultScore}</span>
                      <span className={`text-[22px] font-bold tabular-nums leading-none ${(r.percentage ?? 0) >= 50 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {r.percentage != null ? `${r.percentage}%` : r.score != null ? `${r.score}` : t.resultPending}
                        {r.total_questions > 0 && r.percentage != null && (
                          <span className="block text-[11px] font-normal text-gray-500 text-right">
                            {r.score}/{r.total_questions}
                          </span>
                        )}
                      </span>
                    </div>

                    {/* Status */}
                    <div className="flex items-center justify-between bg-gray-50 border border-gray-100 rounded-lg px-3.5 py-2.5">
                      <span className="text-[13px] text-gray-500 font-medium">{t.resultStatus}</span>
                      <span className={`text-[11px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full ${
                        r.status === 'Completed' ? 'bg-emerald-100 text-emerald-700' :
                        r.status === 'Banned' ? 'bg-red-100 text-red-700' :
                        'bg-amber-100 text-amber-700'
                      }`}>
                        {r.status === 'Completed' ? t.resultStatusCompleted : r.status === 'Banned' ? t.resultStatusBanned : t.resultStatusOther}
                      </span>
                    </div>

                    {r.completed_at && (
                      <p className="text-[12px] text-gray-400 text-center">
                        {t.resultCompletedLabel}: {new Date(r.completed_at).toLocaleString()}
                      </p>
                    )}
                  </div>

                  {r.status === 'Completed' && r.result_public_id && (
                    <div className="px-4 sm:px-5 pb-4 space-y-2">
                      <AdminBtn
                        variant="ghost"
                        size="md"
                        className="w-full"
                        loading={detailLoading}
                        onClick={() => openResultDetail(r.exam_id)}
                        icon={
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        }
                      >
                        {t.studentResultCertificateBtn}
                      </AdminBtn>
                      <AdminBtn
                        variant="blue"
                        size="md"
                        className="w-full"
                        loading={pdfDownloadingId === r.exam_id}
                        onClick={() => downloadCertificate(r.exam_id, r.result_public_id)}
                        icon={
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
                          </svg>
                        }
                      >
                        {t.resultDownloadPdf}
                      </AdminBtn>
                    </div>
                  )}
                </motion.div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </div>
  );
}
