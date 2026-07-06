import React, { useState, useEffect, useRef, useCallback } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Login } from './pages/Login';
import { AdminDashboard } from './pages/AdminDashboard';
import { StaffDashboard } from './pages/StaffDashboard';
import { StudentDashboard } from './pages/StudentDashboard';
import { PublicVerifyResult } from './pages/PublicVerifyResult';
import { ExamResultSummary, type ExamResultPayload } from './components/ExamResultSummary';
import { PreExamCheck } from './pages/PreExamCheck';
import { ExamRoom } from './pages/ExamRoom';
import { Button } from './components/ui';
import { translations, Language } from './i18n';
import { InstituteLogo } from './components/InstituteLogo';
import { clearDeviceSessionToken, examAuthHeaders, setDeviceSessionToken } from './lib/deviceFingerprint';
import { apiUrl } from './lib/apiUrl';
import { readJsonSafe } from './lib/http';

const SUPPORTED_LANGS: Language[] = ['uz', 'ru', 'en'];

/** Admin fetch-larida 401/403 kelsa bu eventni dispatch qiling → App avtomatik logout qiladi */
export const AUTH_ERROR_EVENT = 'auth:error';

const SESSION_KEYS = new Set(['token', 'user']);

function storageFor(key: string): Storage {
  return SESSION_KEYS.has(key) ? sessionStorage : localStorage;
}

function safeStorageGet(key: string): string | null {
  try {
    return storageFor(key).getItem(key);
  } catch {
    return null;
  }
}

function safeStorageSet(key: string, value: string): void {
  try {
    storageFor(key).setItem(key, value);
  } catch {
    /* ignore storage quota/private mode */
  }
}

function safeStorageRemove(key: string): void {
  try {
    storageFor(key).removeItem(key);
  } catch {
    /* ignore storage quota/private mode */
  }
}

function readStoredSession(): { token: string; user: any } {
  const token = (safeStorageGet('token') || '').trim();
  let user: any = null;
  try {
    const raw = safeStorageGet('user');
    user = raw ? JSON.parse(raw) : null;
  } catch {
    user = null;
  }
  if (user?.role === 'teacher') {
    safeStorageRemove('token');
    safeStorageRemove('user');
    return { token: '', user: null };
  }
  const valid = Boolean(token && user && typeof user === 'object' && user.id && user.role);
  if (token && !valid) {
    safeStorageRemove('token');
    safeStorageRemove('user');
    return { token: '', user: null };
  }
  return { token: valid ? token : '', user: valid ? user : null };
}

function AppContent() {
  const initial = readStoredSession();
  const [token, setToken] = useState(initial.token);
  const [user, setUser] = useState<any>(initial.user);
  const [activeExam, setActiveExam] = useState<any>(null);
  const [studentExamId, setStudentExamId] = useState<number | null>(null);
  const [examStatus, setExamStatus] = useState<'pending' | 'checking' | 'taking' | 'finished'>('pending');
  const [lastSubmitResult, setLastSubmitResult] = useState<ExamResultPayload | null>(null);
  const [lang, setLang] = useState<Language>(() => {
    const raw = (safeStorageGet('lang') || 'uz').trim() as Language;
    return SUPPORTED_LANGS.includes(raw) ? raw : 'uz';
  });
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    safeStorageSet('lang', lang);
  }, [lang]);

  useEffect(() => {
    if (user?.role === 'teacher') {
      setToken('');
      setUser(null);
      safeStorageRemove('token');
      safeStorageRemove('user');
      navigate('/login');
    }
  }, [user?.role, navigate]);

  const handleLogin = (newToken: string, userData: any) => {
    setToken(newToken);
    setUser(userData);
    safeStorageSet('token', newToken);
    safeStorageSet('user', JSON.stringify(userData));
    navigate('/');
  };

  const handleLogout = useCallback(() => {
    setToken('');
    setUser(null);
    setActiveExam(null);
    setExamStatus('pending');
    clearDeviceSessionToken();
    safeStorageRemove('token');
    safeStorageRemove('user');
    navigate('/login');
  }, [navigate]);

  // Global: har qanday admin fetch 401/403 qaytarsa → avtomatik logout
  useEffect(() => {
    const onAuthError = () => handleLogout();
    window.addEventListener(AUTH_ERROR_EVENT, onAuthError);
    return () => window.removeEventListener(AUTH_ERROR_EVENT, onAuthError);
  }, [handleLogout]);

  // Admin tokenini mount da bir marta backend bilan tekshirish
  const tokenCheckedRef = useRef(false);
  useEffect(() => {
    if (tokenCheckedRef.current || !token || user?.role !== 'admin') return;
    tokenCheckedRef.current = true;
    fetch(apiUrl('/api/admin/groups'), { headers: { Authorization: `Bearer ${token}` } })
      .then(r => { if (r.status === 401 || r.status === 403) handleLogout(); })
      .catch(() => {});
  }, [token, user?.role, handleLogout]);

  const startExamCheck = (exam: any, seId: number) => {
    setActiveExam(exam);
    setStudentExamId(seId);
    setExamStatus('checking');
  };

  const beginExam = (examData: any, seId: number) => {
    setActiveExam(examData);
    setStudentExamId(seId);
    setExamStatus('taking');
  };

  const resumeExam = async (exam: any, pin = '') => {
    if (!token) return;
    try {
      const res = await fetch(apiUrl(`/api/student/exams/${exam.id}/start`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Student-Lang': lang,
          ...examAuthHeaders(token),
        },
        body: JSON.stringify({ pin, student_lang: lang }),
      });
      const data = await readJsonSafe<{
        error?: string;
        exam?: any;
        studentExamId?: number;
        startedAt?: string;
        sessionKey?: string;
        sessionSeqStart?: number;
        sessionChallenge?: string;
        deviceToken?: string;
      }>(res);
      if (!res.ok || !data?.exam || data.studentExamId == null) {
        window.alert(data?.error || translations[lang].preExamStartError);
        return;
      }
      if (data.deviceToken) {
        setDeviceSessionToken(data.deviceToken);
      }
      beginExam(
        {
          ...data.exam,
          startedAt: data.startedAt,
          sessionKey: data.sessionKey,
          sessionSeqStart: data.sessionSeqStart,
          sessionChallenge: data.sessionChallenge,
          preExamPin: pin,
        },
        data.studentExamId,
      );
    } catch {
      window.alert(translations[lang].preExamNetworkError);
    }
  };

  const finishExam = (submitPayload?: ExamResultPayload | null) => {
    setExamStatus('finished');
    setActiveExam(null);
    setStudentExamId(null);
    setLastSubmitResult(submitPayload ?? null);
  };

  if (!token || !user) {
    return (
      <AnimatePresence mode="wait">
        <motion.div 
          key={location.pathname}
          initial={{ opacity: 0, scale: 0.95 }} 
          animate={{ opacity: 1, scale: 1 }} 
          exit={{ opacity: 0, scale: 1.05 }} 
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }} 
          className="min-h-screen w-full"
        >
          <Routes location={location}>
            <Route path="/login" element={<Login onLogin={handleLogin} lang={lang} setLang={setLang} />} />
            <Route path="*" element={<Navigate to="/login" />} />
          </Routes>
        </motion.div>
      </AnimatePresence>
    );
  }

  const t = translations[lang];
  const examTaking = user.role === 'student' && examStatus === 'taking';
  const preExamFullBleed = user.role === 'student' && examStatus === 'checking';
  // Imtihon topshirish paytida sahifa to'liq ekran (kiosk): header yashiriladi,
  // hech qanday chetki bo'shliq/scroll qolmaydi.
  const fullBleed = preExamFullBleed || examTaking;

  return (
    <div className="min-h-screen flex flex-col relative overflow-x-clip">
      {!examTaking && (
      <header className="fixed top-0 left-0 right-0 z-50 bg-white border-b border-gray-200 h-[62px] sm:h-[66px]">
        <div
          className={`flex items-center justify-between h-full ${
            user.role === 'admin' ? 'px-4 sm:px-6' : 'px-4 sm:px-6 max-w-7xl mx-auto'
          }`}
        >
          {/* ── Left ── */}
          <div className="flex items-center gap-3 min-w-0">
            <InstituteLogo size="sm" className="shrink-0" />
            <div className="min-w-0 hidden xs:block sm:block">
              <h1 className="text-[16px] sm:text-[18px] font-semibold tracking-tight text-gray-900 truncate leading-tight">
                {t.appBrandTitle}
              </h1>
              <p className="text-[11px] font-medium leading-none mt-0.5 text-gray-400 truncate hidden sm:block">
                {user.role === 'admin' ? t.adminDash : user.role === 'staff' ? t.roleZoneStaff : t.roleZoneStudent}
              </p>
            </div>
          </div>

          {/* ── Right ── */}
          <div className="flex items-center gap-2 sm:gap-2.5">
            {/* Lang — segmented */}
            <div className="flex items-center h-9 rounded-lg bg-gray-100 p-0.5">
              {(['uz', 'ru', 'en'] as Language[]).map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setLang(l)}
                  className={`h-full px-2.5 sm:px-3 rounded-md text-xs sm:text-[13px] font-semibold transition-colors ${
                    lang === l
                      ? 'bg-white text-indigo-700 shadow-sm'
                      : 'text-gray-500 hover:text-gray-800'
                  }`}
                >
                  {l === 'uz' ? "O'z" : l === 'ru' ? 'Ру' : 'En'}
                </button>
              ))}
            </div>

            {/* User pill */}
            <div className="hidden sm:flex items-center gap-2.5 h-9 pl-1 pr-3 rounded-lg border border-gray-200 bg-white">
              <div className="w-7 h-7 rounded-md flex items-center justify-center text-[13px] font-semibold text-white shrink-0 bg-indigo-600">
                {(user.name || user.id || '?').toString().charAt(0).toUpperCase()}
              </div>
              <div className="flex flex-col leading-tight min-w-0">
                <span className="text-[13px] font-semibold text-gray-800 truncate max-w-[160px] lg:max-w-[220px]">
                  {user.name || user.id}
                </span>
                <span className="text-[10.5px] text-gray-400 capitalize leading-none">
                  {user.role}
                </span>
              </div>
            </div>

            {/* Logout */}
            <button
              type="button"
              onClick={handleLogout}
              className="h-9 px-3 sm:px-3.5 rounded-lg border border-gray-200 bg-white hover:bg-red-50 hover:border-red-200 hover:text-red-600 text-gray-600 text-[13px] font-medium transition-colors inline-flex items-center gap-1.5"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              <span className="hidden sm:inline">{t.logout}</span>
            </button>
          </div>
        </div>
      </header>
      )}

      <main
        className={`flex-1 min-h-0 w-full relative z-10 ${
          fullBleed
            ? 'max-w-none px-0 pt-0'
            : user.role === 'admin'
              ? 'max-w-none px-0 pt-[62px] sm:pt-[66px]'
              : 'max-w-7xl mx-auto px-3 sm:px-6 pt-24 sm:pt-28 pb-6 sm:pb-8'
        }`}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={user.role + examStatus}
            initial={user.role === 'admin' ? { opacity: 0 } : { opacity: 0, y: 20, filter: 'blur(10px)' }}
            animate={user.role === 'admin' ? { opacity: 1 } : { opacity: 1, y: 0, filter: 'blur(0px)' }}
            exit={user.role === 'admin' ? { opacity: 0 } : { opacity: 0, y: -20, filter: 'blur(10px)' }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          >
            {user.role === 'admin' && (
              <div className="min-h-[calc(100vh-62px)] sm:min-h-[calc(100vh-66px)] bg-white [--admin-header-h:62px] sm:[--admin-header-h:66px]">
                <AdminDashboard token={token} lang={lang} adminUserId={user?.id ? String(user.id) : undefined} />
              </div>
            )}
            {user.role === 'staff' && <StaffDashboard token={token} lang={lang} />}
            {user.role === 'student' && examStatus === 'pending' && (
              <div>
                <StudentDashboard token={token} user={user} onStartExam={startExamCheck} onResumeExam={resumeExam} lang={lang} />
              </div>
            )}
            {user.role === 'student' && examStatus === 'checking' && activeExam && (
              <PreExamCheck 
                exam={activeExam} 
                token={token} 
                lang={lang}
                user={user}
                onComplete={beginExam} 
                onCancel={() => setExamStatus('pending')} 
              />
            )}
            {user.role === 'student' && examStatus === 'taking' && activeExam && (
              <ExamRoom 
                exam={activeExam} 
                studentExamId={studentExamId ?? 0} 
                token={token} 
                user={user}
                lang={lang}
                onFinish={finishExam} 
              />
            )}
            {user.role === 'student' && examStatus === 'finished' && lastSubmitResult && (
              <ExamResultSummary
                data={lastSubmitResult}
                token={token}
                lang={lang}
                onBack={() => {
                  setLastSubmitResult(null);
                  setExamStatus('pending');
                }}
              />
            )}
            {user.role === 'student' && examStatus === 'finished' && !lastSubmitResult && (
              <div className="text-center py-32 glass-panel max-w-2xl mx-auto mt-12">
                <div className="w-24 h-24 bg-green-500/10 text-green-500 rounded-full flex items-center justify-center mx-auto mb-6">
                  <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                </div>
                <h2 className="text-3xl font-bold mb-4 tracking-tight">{t.examFinishedTitle}</h2>
                <p className="text-gray-500 mb-8 text-lg">{t.examFinishedBody}</p>
                <Button onClick={() => setExamStatus('pending')} size="lg">{t.studentDash}</Button>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Kiosk (imtihonga kirish/topshirish) paytida footer yashiriladi — ekranga to'liq sig'sin, scroll bo'lmasin. */}
      {!fullBleed && (
      <footer className="w-full mt-auto py-2 px-4 border-t border-gray-200/40 bg-white/20">
        <div className="flex flex-col sm:flex-row items-center justify-center gap-2 sm:gap-3 max-w-3xl mx-auto">
          <InstituteLogo size="xs" className="opacity-90" />
          <p className="text-[10px] leading-tight text-gray-400 font-normal tracking-wide text-center">
            © {new Date().getFullYear()} Fjsti Online Exam · Farg‘ona jamoat salomatligi tibbiyot instituti
          </p>
        </div>
      </footer>
      )}
    </div>
  );
}

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/verify/result/:resultId" element={<PublicVerifyResult />} />
        <Route path="*" element={<AppContent />} />
      </Routes>
    </Router>
  );
}
