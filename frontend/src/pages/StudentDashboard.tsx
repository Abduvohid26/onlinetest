import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { translations, Language } from '../i18n';
import { ExamResultSummary, type ExamResultPayload } from '../components/ExamResultSummary';
import { readJsonSafe } from '../lib/http';
import { apiUrl } from '../lib/apiUrl';
import { formatCountdown, formatExamDateTime, msUntil } from '../lib/datetimeLocal';
import { AdminBtn, AdminAlert, AdminInput } from './admin/ui';

const REFRESH_INTERVAL_MS = 30_000;
const REFRESH_BANNED_WAIT_MS = 8_000;

/* Sahifa ichidagi qo'shimcha matnlar (uz/ru/en) — katta i18n fayliga tegmasdan. */
const LOCAL: Record<Language, Record<string, string>> = {
  uz: {
    greeting: 'Xush kelibsiz',
    subtitleActive: 'ta imtihon topshirishga tayyor',
    subtitleNone: 'Hozircha ochiq imtihon yo‘q',
    statActive: 'Faol imtihonlar',
    statCompleted: 'Yakunlangan',
    statAvg: 'O‘rtacha natija',
    pillLive: 'Faol',
    scoreLabel: 'Natija',
    pendingEval: 'Baholanmoqda',
    questionsWord: 'savol',
  },
  ru: {
    greeting: 'Добро пожаловать',
    subtitleActive: 'экзамен(ов) готов(ы) к сдаче',
    subtitleNone: 'Пока нет открытых экзаменов',
    statActive: 'Активные экзамены',
    statCompleted: 'Завершено',
    statAvg: 'Средний балл',
    pillLive: 'Идёт',
    scoreLabel: 'Результат',
    pendingEval: 'На проверке',
    questionsWord: 'вопр.',
  },
  en: {
    greeting: 'Welcome',
    subtitleActive: 'exam(s) ready to take',
    subtitleNone: 'No open exams right now',
    statActive: 'Active exams',
    statCompleted: 'Completed',
    statAvg: 'Average score',
    pillLive: 'Live',
    scoreLabel: 'Score',
    pendingEval: 'Under review',
    questionsWord: 'questions',
  },
};

/* Ball rangi — 50%+ yashil, 40–49 amber, past qizil. */
function scoreTone(pct: number): { text: string; bar: string } {
  if (pct >= 50) return { text: 'text-emerald-600', bar: 'bg-emerald-500' };
  if (pct >= 40) return { text: 'text-amber-600', bar: 'bg-amber-500' };
  return { text: 'text-red-600', bar: 'bg-red-500' };
}

/* Kichik statistika plitkasi. */
function StatTile({
  label,
  value,
  accent,
  icon,
}: {
  label: string;
  value: React.ReactNode;
  accent?: boolean;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-3 sm:px-4 py-3 sm:py-3.5 flex items-center gap-2.5 sm:gap-3">
      <div
        className={`hidden sm:flex w-9 h-9 rounded-lg items-center justify-center shrink-0 ${
          accent ? 'bg-indigo-50 text-indigo-600' : 'bg-gray-100 text-gray-500'
        }`}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-[18px] sm:text-[19px] font-bold text-gray-900 leading-none tabular-nums">{value}</div>
        <div className="text-[11px] sm:text-[11.5px] text-gray-500 mt-1 leading-tight">{label}</div>
      </div>
    </div>
  );
}

export function StudentDashboard({
  token,
  user,
  onStartExam,
  onResumeExam,
  lang,
}: {
  token: string;
  user?: { name?: string | null; group_id?: number | null; group_name?: string | null };
  onStartExam: (exam: any, studentExamId: number) => void;
  onResumeExam: (exam: any, pin?: string) => void | Promise<void>;
  lang: Language;
}) {
  const [exams, setExams] = useState<any[]>([]);
  const [resumePins, setResumePins] = useState<Record<number, string>>({});
  const [resumeBusyId, setResumeBusyId] = useState<number | null>(null);
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
  const L = LOCAL[lang];
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
    return () => { cancelledRef.current = true; };
  }, [fetchData]);

  const hasBannedResult = results.some((r: any) => r.status === 'Banned');
  const refreshMs = hasBannedResult ? REFRESH_BANNED_WAIT_MS : REFRESH_INTERVAL_MS;

  useEffect(() => {
    const id = window.setInterval(() => void fetchData(), refreshMs);
    return () => clearInterval(id);
  }, [fetchData, refreshMs]);

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
        <div className="rounded-2xl border border-red-200 bg-white p-8 text-center shadow-sm">
          <div className="w-16 h-16 bg-red-50 text-red-600 rounded-2xl flex items-center justify-center mx-auto mb-5">
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
          </div>
          <h2 className="text-[18px] font-bold text-gray-900 mb-1.5">{t.studentAccountBannedTitle}</h2>
          <p className="text-[14px] text-gray-500 leading-relaxed">{t.studentAccountBannedBody}</p>
        </div>
      </div>
    );
  }

  void tick;
  const now = nowMs();

  // Hali tugamagan imtihonlar yoki yarim qolgan sessiya (in_progress).
  const visibleExams = exams.filter(
    (e: any) => now <= new Date(e.end_time).getTime() || e.in_progress,
  );
  const ongoingCount = visibleExams.filter(
    (e: any) => now >= new Date(e.start_time).getTime() && now <= new Date(e.end_time).getTime(),
  ).length;

  const completedResults = results.filter((r: any) => r.status === 'Completed');
  const gradedPcts = completedResults
    .map((r: any) => r.percentage)
    .filter((p: any) => typeof p === 'number');
  const avgPct = gradedPcts.length
    ? Math.round(gradedPcts.reduce((a: number, b: number) => a + b, 0) / gradedPcts.length)
    : null;

  const firstName = (user?.name || '').toString().trim().split(/\s+/)[0] || '';

  const Tab = ({ id, label, count }: { id: 'available' | 'results'; label: string; count: number }) => {
    const active = activeTab === id;
    return (
      <button
        onClick={() => setActiveTab(id)}
        className={`h-9 px-3 sm:px-4 rounded-lg text-[12.5px] sm:text-[13px] font-semibold transition-colors inline-flex items-center justify-center gap-2 whitespace-nowrap flex-1 sm:flex-none ${
          active ? 'bg-white text-gray-900 shadow-sm border border-gray-200' : 'text-gray-500 hover:text-gray-800'
        }`}
      >
        {label}
        <span
          className={`text-[11px] font-bold tabular-nums px-1.5 h-[18px] min-w-[18px] inline-flex items-center justify-center rounded-full ${
            active ? 'bg-indigo-50 text-indigo-600' : 'bg-gray-200/70 text-gray-500'
          }`}
        >
          {count}
        </span>
      </button>
    );
  };

  return (
    <div className="px-3 sm:px-6 py-4 sm:py-6 max-w-6xl mx-auto relative">
      {/* Result detail overlay — createPortal orqali document.body ga chiqariladi. */}
      {detailPayload && createPortal(
        <div className="fixed inset-0 z-[100] bg-slate-900/50 backdrop-blur-sm">
          <div className="h-full overflow-y-auto overscroll-y-contain">
            <div className="sticky top-0 z-20 flex justify-end px-3 sm:px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 bg-gradient-to-b from-slate-900/80 via-slate-900/40 to-transparent pointer-events-none">
              <button
                type="button"
                onClick={() => setDetailPayload(null)}
                aria-label={t.studentDash}
                className="pointer-events-auto w-10 h-10 rounded-full bg-white shadow-lg border border-gray-200 text-gray-600 hover:bg-gray-50 hover:text-gray-900 flex items-center justify-center transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="px-3 sm:px-4 pb-[max(1rem,env(safe-area-inset-bottom))] max-w-4xl mx-auto -mt-2">
              <ExamResultSummary
                data={detailPayload}
                token={token}
                lang={lang}
                onBack={() => setDetailPayload(null)}
              />
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* ── Page header ── */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-5">
        <div className="min-w-0">
          <h1 className="text-[22px] sm:text-[26px] font-bold tracking-tight text-gray-900 leading-tight">
            {L.greeting}{firstName ? `, ${firstName}` : ''}
          </h1>
          <p className="text-[13.5px] text-gray-500 mt-1">
            {visibleExams.length > 0
              ? <>
                  <span className="font-semibold text-gray-700">{visibleExams.length}</span> {L.subtitleActive}
                </>
              : L.subtitleNone}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="hidden sm:inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-gray-200 bg-white text-[12px] text-gray-500 tabular-nums">
            <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {formatExamDateTime(new Date(now).toISOString(), lang)}
          </div>
          <AdminBtn
            variant="ghost"
            size="md"
            loading={refreshing}
            onClick={handleManualReload}
            icon={
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            }
          >
            <span className="hidden sm:inline">{t.reload ?? 'Yangilash'}</span>
          </AdminBtn>
        </div>
      </div>

      {/* ── Stat tiles ── */}
      <div className="grid grid-cols-3 gap-2.5 sm:gap-3 mb-5">
        <StatTile
          label={L.statActive}
          value={visibleExams.length}
          accent
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.9} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
          }
        />
        <StatTile
          label={L.statCompleted}
          value={completedResults.length}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.9} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
        <StatTile
          label={L.statAvg}
          value={avgPct != null ? `${avgPct}%` : '—'}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.9} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
          }
        />
      </div>

      {/* ── Tabs ── */}
      <div className="flex items-center gap-1 h-11 rounded-xl bg-gray-100 p-1 border border-gray-200 w-full sm:w-fit mb-5">
        <Tab id="available" label={t.tabAvailableExams} count={visibleExams.length} />
        <Tab id="results" label={t.tabMyResults} count={results.length} />
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
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-xl border border-gray-200 bg-white p-5 space-y-3 animate-pulse">
              <div className="h-4 bg-gray-100 rounded w-3/4" />
              <div className="h-3 bg-gray-100 rounded w-1/2" />
              <div className="h-3 bg-gray-100 rounded w-2/3" />
              <div className="h-10 bg-gray-100 rounded-lg mt-4" />
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
              className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4"
            >
              {exams.length === 0 ? (
                <EmptyState
                  icon={
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                  }
                  title={t.emptyStudentExams}
                  hint={!user?.group_id ? t.studentNoGroupHint : t.studentNoExamsForGroupHint.replace('{group}', user.group_name || String(user.group_id))}
                />
              ) : visibleExams.length === 0 ? (
                <EmptyState
                  icon={
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  }
                  title={t.studentNoOpenExamsTitle}
                  hint={t.studentNoOpenExamsHint}
                />
              ) : (
                visibleExams.map((e: any, i) => {
                  const startMs = new Date(e.start_time).getTime();
                  const endMs = new Date(e.end_time).getTime();
                  const isOngoing = now >= startMs && now <= endMs;
                  const isUpcoming = now < startMs;
                  const untilStart = msUntil(e.start_time, now);
                  const showLive = isOngoing || e.in_progress;

                  return (
                    <motion.div
                      key={e.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.04 }}
                      className={`group flex flex-col rounded-xl border bg-white overflow-hidden transition-all ${
                        showLive ? 'border-gray-200 hover:border-indigo-300 hover:shadow-md' : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      {/* Status strip */}
                      <div className="px-5 pt-4 flex items-center justify-between gap-2">
                        {showLive ? (
                          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-emerald-700 bg-emerald-50 px-2 py-1 rounded-md">
                            <span className="relative flex h-2 w-2">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                            </span>
                            {L.pillLive}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-amber-700 bg-amber-50 px-2 py-1 rounded-md">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                            {t.examStateUpcoming}
                          </span>
                        )}
                        <span className="shrink-0 text-[10px] font-semibold bg-gray-100 text-gray-500 px-2 py-0.5 rounded-md uppercase tracking-wide">
                          {e.language}
                        </span>
                      </div>

                      <div className="px-5 pt-2.5 pb-4 flex-1">
                        <h3 className="text-[15.5px] font-semibold text-gray-900 leading-snug mb-3.5">{e.title}</h3>

                        <dl className="space-y-2.5 text-[13px]">
                          <MetaRow
                            icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />}
                            label={t.startTime}
                            value={formatExamDateTime(e.start_time, lang)}
                          />
                          <MetaRow
                            icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />}
                            label={t.endTime}
                            value={formatExamDateTime(e.end_time, lang)}
                          />
                          <div className="flex items-center justify-between gap-2 pt-2.5 border-t border-gray-100">
                            <span className="text-gray-500 inline-flex items-center gap-2">
                              <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                              {t.duration}
                            </span>
                            <span className="font-semibold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-md text-[12px] tabular-nums">
                              {e.duration_minutes} {t.minutesShort}
                            </span>
                          </div>
                          {e.exam_mode === 'bank_mixed' && e.bank_question_count ? (
                            <MetaRow
                              icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />}
                              label={t.examBankQuestionCount}
                              value={String(e.bank_question_count)}
                            />
                          ) : null}
                        </dl>

                        {(isUpcoming && untilStart > 0) || e.has_pin ? (
                          <div className="mt-3.5 flex flex-wrap gap-1.5">
                            {isUpcoming && untilStart > 0 && (
                              <span className="text-[11.5px] text-amber-700 bg-amber-50 border border-amber-100 rounded-md px-2 py-1">
                                {t.examStartsIn}: <strong className="tabular-nums">{formatCountdown(untilStart, lang)}</strong>
                              </span>
                            )}
                            {e.has_pin && (
                              <span className="inline-flex items-center gap-1 text-[11.5px] font-medium text-gray-600 bg-gray-50 border border-gray-200 rounded-md px-2 py-1">
                                <svg className="w-3.5 h-3.5 shrink-0 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                                {t.examPinRequiredBadge}
                              </span>
                            )}
                          </div>
                        ) : null}
                      </div>

                      <div className="px-5 pb-5">
                        {e.in_progress ? (
                          <div className="space-y-2.5">
                            <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-indigo-700 bg-indigo-50 px-2 py-1 rounded-md">
                              {t.examInProgressBadge}
                            </span>
                            {e.has_pin && (
                              <AdminInput
                                type="password"
                                value={resumePins[e.id] || ''}
                                onChange={(ev) => setResumePins((prev) => ({ ...prev, [e.id]: ev.target.value }))}
                                placeholder={t.enterPin}
                                className="text-center tracking-widest h-10"
                                autoComplete="off"
                              />
                            )}
                            <AdminBtn
                              variant="emerald"
                              size="lg"
                              className="w-full"
                              loading={resumeBusyId === e.id}
                              disabled={e.has_pin && !(resumePins[e.id] || '').trim()}
                              onClick={async () => {
                                setResumeBusyId(e.id);
                                try {
                                  await onResumeExam(e, resumePins[e.id] || '');
                                } finally {
                                  setResumeBusyId(null);
                                }
                              }}
                            >
                              {t.resumeExam}
                            </AdminBtn>
                          </div>
                        ) : isOngoing ? (
                          <AdminBtn variant="blue" size="lg" className="w-full" onClick={() => onStartExam(e, 0)} iconRight={
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M9 5l7 7-7 7" /></svg>
                          }>
                            {t.takeExam}
                          </AdminBtn>
                        ) : (
                          <AdminBtn variant="ghost" size="lg" className="w-full" disabled>
                            {t.examStateUpcoming}{untilStart > 0 ? ` · ${formatCountdown(untilStart, lang)}` : ''}
                          </AdminBtn>
                        )}
                      </div>
                    </motion.div>
                  );
                })
              )}
            </motion.div>
          ) : (
            <motion.div
              key="results"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2 }}
              className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4"
            >
              {results.length === 0 ? (
                <EmptyState
                  icon={
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  }
                  title={t.emptyStudentResults}
                />
              ) : (
                results.map((r: any, i) => {
                  const isCompleted = r.status === 'Completed';
                  const isBannedRes = r.status === 'Banned';
                  const pct = typeof r.percentage === 'number' ? r.percentage : null;
                  const tone = pct != null ? scoreTone(pct) : null;

                  return (
                    <motion.div
                      key={r.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.04 }}
                      className="flex flex-col rounded-xl border border-gray-200 bg-white overflow-hidden hover:border-gray-300 transition-colors"
                    >
                      {/* Header: title + status pill */}
                      <div className="px-5 py-4 flex items-start justify-between gap-3 border-b border-gray-100">
                        <h3 className="text-[14.5px] font-semibold text-gray-900 leading-snug min-w-0">{r.title}</h3>
                        <span className={`shrink-0 text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-md ${
                          isCompleted ? 'bg-emerald-50 text-emerald-700' :
                          isBannedRes ? 'bg-red-50 text-red-700' :
                          'bg-amber-50 text-amber-700'
                        }`}>
                          {isCompleted ? t.resultStatusCompleted : isBannedRes ? t.resultStatusBanned : t.resultStatusOther}
                        </span>
                      </div>

                      {/* Body: score focal */}
                      <div className="px-5 py-4 flex-1 flex flex-col justify-center">
                        {isCompleted && pct != null ? (
                          <>
                            <div className="flex items-baseline justify-between mb-2">
                              <span className="text-[12px] text-gray-500 font-medium">{L.scoreLabel}</span>
                              <span className={`text-[26px] font-bold leading-none tabular-nums ${tone!.text}`}>{pct}%</span>
                            </div>
                            <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                              <div className={`h-full rounded-full ${tone!.bar}`} style={{ width: `${Math.max(3, Math.min(100, pct))}%` }} />
                            </div>
                            <div className="flex items-center justify-between mt-2.5 text-[11.5px] text-gray-400">
                              <span className="tabular-nums">{r.score}/{r.total_questions} {L.questionsWord}</span>
                              {r.completed_at && <span className="tabular-nums">{new Date(r.completed_at).toLocaleDateString()}</span>}
                            </div>
                          </>
                        ) : isBannedRes ? (
                          <div className="flex items-center gap-3 py-1">
                            <div className="w-10 h-10 rounded-lg bg-red-50 text-red-600 flex items-center justify-center shrink-0">
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" /></svg>
                            </div>
                            <div>
                              <div className="text-[14px] font-semibold text-gray-900">{t.resultStatusBanned}</div>
                              <div className="text-[12px] text-gray-400">{L.scoreLabel}: —</div>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center gap-3 py-1">
                            <div className="w-10 h-10 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                            </div>
                            <div>
                              <div className="text-[14px] font-semibold text-gray-900">{L.pendingEval}</div>
                              <div className="text-[12px] text-gray-400">{t.resultPending}</div>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Footer: actions (only completed with public id) */}
                      {isCompleted && r.result_public_id && (
                        <div className="px-5 pb-4 pt-0 flex gap-2">
                          <AdminBtn
                            variant="ghost"
                            size="md"
                            className="flex-1"
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
                            className="shrink-0 px-3"
                            loading={pdfDownloadingId === r.exam_id}
                            onClick={() => downloadCertificate(r.exam_id, r.result_public_id)}
                            aria-label={t.resultDownloadPdf}
                            icon={
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
                              </svg>
                            }
                          >
                            PDF
                          </AdminBtn>
                        </div>
                      )}
                    </motion.div>
                  );
                })
              )}
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </div>
  );
}

/* ── Meta row (icon + label + value) ─────────────────────────────────────── */
function MetaRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-gray-500 inline-flex items-center gap-2">
        <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">{icon}</svg>
        {label}
      </span>
      <span className="font-medium text-gray-900 tabular-nums text-right">{value}</span>
    </div>
  );
}

/* ── Empty state (full-width, centered) ──────────────────────────────────── */
function EmptyState({ icon, title, hint }: { icon: React.ReactNode; title: string; hint?: string }) {
  return (
    <div className="col-span-full">
      <div className="rounded-2xl border border-dashed border-gray-300 bg-white py-16 px-6 text-center">
        <div className="w-14 h-14 bg-gray-50 border border-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4 text-gray-400">
          {icon}
        </div>
        <p className="text-[15px] font-semibold text-gray-700 mb-1">{title}</p>
        {hint && (
          <p className="text-[13px] text-gray-500 max-w-md mx-auto mt-2">{hint}</p>
        )}
      </div>
    </div>
  );
}
