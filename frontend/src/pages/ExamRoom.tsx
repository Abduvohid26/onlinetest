import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { AdminBtn, AdminAlert } from './admin/ui';
import { useServerProctoring } from '../lib/useServerProctoring';
import { useRealtimeProctoring } from '../lib/useRealtimeProctoring';
import type { FaceStatusLive } from '../lib/realtimeProctor';
import { analyzeVoiceFrame, VoiceActivityTracker } from '../lib/voiceActivity';
import { motion, AnimatePresence } from 'motion/react';
import { Calculator } from '../components/Calculator';
import { createRealtimeSocket, buildRealtimeUrl, type RealtimeSocket } from '../lib/realtimeSocket';
import { translations, Language } from '../i18n';
import { readJsonSafe } from '../lib/http';
import { apiUrl } from '../lib/apiUrl';
import { examAuthHeaders } from '../lib/deviceFingerprint';
import { buildGuardedExamHeaders, syncVacFromResponse } from '../lib/examRequestGuard';
import type { ExamResultPayload } from '../components/ExamResultSummary';
import {
  openPreferredProctorStream,
  VIRTUAL_CAMERA_BLOCKED_MESSAGE,
} from '../lib/preferredCameraStream';
import { compressVideoFrameToJpeg } from '../lib/compressToJpeg';
import { cleanQuestionPrompt, normalizeQuestionOptions, optionLetter } from '../lib/examQuestionUtils';

// Identity check: har 3 soniyada (OpenCV SFace lokal, tez ~100ms; throttle 60/min)
const IDENTITY_CHECK_MS = 3_000;

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.05
    }
  }
};

const item: any = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 300, damping: 24 } }
};

interface ExamRoomProps {
  exam: any;
  studentExamId: number;
  token: string;
  user: any;
  lang: Language;
  onFinish: (submitPayload?: ExamResultPayload | null) => void;
}

function extractQuestionImages(text: string): { cleanText: string; images: string[] } {
  const src = text || '';
  const images: string[] = [];
  const mdRe = /!\[[^\]]*\]\((https?:\/\/[^\s)]+\.(?:png|jpe?g|gif|webp))\)/gi;
  let clean = src.replace(mdRe, (_, url: string) => {
    images.push(url);
    return '';
  });
  const rawRe = /(https?:\/\/[^\s]+?\.(?:png|jpe?g|gif|webp))/gi;
  clean = clean.replace(rawRe, (url: string) => {
    if (!images.includes(url)) images.push(url);
    return '';
  });
  return { cleanText: clean.trim(), images };
}

function sanitizeExamAnswers(
  questions: Array<{ id: number | string; options?: string[] }>,
  raw: Record<string, string> | null | undefined,
): Record<string, string> {
  if (!raw || typeof raw !== 'object') return {};
  const optionMap = new Map<string, Set<string>>();
  for (const q of questions || []) {
    const qKey = String(q?.id ?? '');
    if (!qKey) continue;
    const opts = Array.isArray(q?.options) ? q.options.filter((x): x is string => typeof x === 'string') : [];
    optionMap.set(qKey, new Set(opts));
  }
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    const qKey = String(key);
    const answer = typeof value === 'string' ? value : '';
    const allowed = optionMap.get(qKey);
    if (!allowed || !answer || !allowed.has(answer)) continue;
    clean[qKey] = answer;
  }
  return clean;
}

function parseAnswersJson(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function safeLocalGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeLocalSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore quota/private mode */
  }
}

function safeLocalRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore quota/private mode */
  }
}

function initialSecondsLeft(exam: ExamRoomProps['exam']) {
  if (exam.submission_deadline) {
    const end = new Date(exam.submission_deadline).getTime();
    const s = Math.floor((end - Date.now()) / 1000);
    if (!Number.isNaN(end) && s > 0) return s;
  }
  if (!exam.startedAt) return exam.duration_minutes * 60;
  const startedAtTime = new Date(exam.startedAt).getTime();
  const elapsedSeconds = Math.floor((Date.now() - startedAtTime) / 1000);
  const totalDurationSeconds = exam.duration_minutes * 60;
  const remaining = totalDurationSeconds - elapsedSeconds;
  return remaining > 0 ? remaining : 0;
}

// Ogohlantirish modal uchun state turi
interface ViolationWarning {
  reason: string;
  warningNumber: number;
  isFinalWarning: boolean;
}

export function ExamRoom({ exam, studentExamId, token, user, lang, onFinish }: ExamRoomProps) {
  const t = translations[lang];
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [flaggedQuestions, setFlaggedQuestions] = useState<number[]>([]);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  /** Internet bor, lekin Socket.io (proktor/realtime) ulanmagan yoki uzilgan. */
  const [realtimeSyncOffline, setRealtimeSyncOffline] = useState(false);
  const [realtimeBannerDismissed, setRealtimeBannerDismissed] = useState(false);
  const [banned, setBanned] = useState(false);
  const [timeLeft, setTimeLeft] = useState(() => initialSecondsLeft(exam));
  const [showTimeWarning, setShowTimeWarning] = useState(false);
  /** Ogohlantirish bosqichi 1–3 (serverdagi warn_types soni; ban 4-chi hodisada). */
  const [strikeLevel, setStrikeLevel] = useState(0);
  // Umumiy ogohlantirish/xato xabarlari — navbat (queue) bilan.
  // Rasmiy ogohlantirish yoki ban modali ochiq bo'lsa, bu xabarlar orqada yashiringan
  // bo'lardi (ikkalasi ham ekran markazida) va taymer ular ko'rinmasdan turib
  // tugab, xabar yo'qolib ketardi. Shu sabab: navbatdagi birinchi xabar faqat
  // boshqa bloklovchi modal yo'q paytda "faol" hisoblanadi va o'shanda taymer boshlanadi.
  const [warningQueue, setWarningQueue] = useState<{ id: number; text: string; duration: number }[]>([]);
  const warningIdRef = useRef(0);
  const showWarningMsg = useCallback((text: string, duration = 5000) => {
    const id = ++warningIdRef.current;
    setWarningQueue((q) => [...q, { id, text, duration }]);
  }, []);
  const dismissWarningMsg = useCallback((id: number) => {
    setWarningQueue((q) => q.filter((m) => m.id !== id));
  }, []);
  const [submitting, setSubmitting] = useState(false);
  const [hardBlocked, setHardBlocked] = useState(false);
  const [banPdfBusy, setBanPdfBusy] = useState(false);
  const [appealReason, setAppealReason] = useState('');
  const [appealBusy, setAppealBusy] = useState(false);
  const [appealMsg, setAppealMsg] = useState('');
  /** BAN paytida serverdagi jami violation yozuvlari (3 ta "!" o'rniga) */
  const [banViolationsCount, setBanViolationsCount] = useState<number | null>(null);
  // Ogohlantirish modal
  const [violationWarning, setViolationWarning] = useState<ViolationWarning | null>(null);
  // Modal ochiqligida yangi violationlar serverga yuborilmasin
  const warningModalShowingRef = useRef(false);
  /** Kamera oqimi video elementga ulangach +1 (async setup va ref vaqti sinxroni). */
  const [proctorStreamRevision, setProctorStreamRevision] = useState(0);
  const [faceStatus, setFaceStatus] = useState<FaceStatusLive>('WAITING');
  const [identityStatus, setIdentityStatus] = useState<'idle' | 'checking' | 'ok' | 'fail'>('idle');
  const identityStatusTimerRef = useRef<number | null>(null);
  const [proctorRetryNonce, setProctorRetryNonce] = useState(0);
  const [cameraPreviewOk, setCameraPreviewOk] = useState(false);
  const [cameraErrorHint, setCameraErrorHint] = useState('');
  const enableSizeHeuristicDevtools =
    String(import.meta.env.VITE_DEVTOOLS_SIZE_HEURISTIC || '').toLowerCase().trim() === 'true';
  const devtoolsShortcutCooldownUntilRef = useRef(0);
  const vacStateRef = useRef({
    seq: Number(exam.sessionSeqStart || 1),
    challengeSeed: exam.sessionChallenge as string | undefined,
  });

  useEffect(() => {
    vacStateRef.current = {
      seq: Number(exam.sessionSeqStart || 1),
      challengeSeed: exam.sessionChallenge,
    };
  }, [exam.sessionSeqStart, exam.sessionChallenge, exam.id]);

  const syncVacIfOk = (res: Response) => {
    syncVacFromResponse(res.headers, vacStateRef.current);
  };

  const nextGuardHeaders = useCallback(
    async (method: string, path: string) =>
      buildGuardedExamHeaders({
        token,
        examId: exam.id,
        studentExamId,
        studentId: String(user.id),
        sessionKey: exam.sessionKey,
        challengeSeed: vacStateRef.current.challengeSeed,
        seq: vacStateRef.current.seq,
        method,
        path,
      }),
    [token, exam.id, exam.sessionKey, studentExamId, user.id],
  );

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(apiUrl(`/api/student/exams/${exam.id}/draft`), {
          headers: await nextGuardHeaders('GET', `/api/student/exams/${exam.id}/draft`),
        });
        syncVacIfOk(res);
        const data = await readJsonSafe<{
          answers?: Record<string, string>;
          flaggedQuestions?: number[];
          updated_at?: string | null;
        }>(res);
        if (!res.ok || cancelled) return;
        const localRaw = safeLocalGet(`exam_answers_${exam.id}`);
        const localAns = sanitizeExamAnswers(exam.questions, parseAnswersJson(localRaw));
        const srv = sanitizeExamAnswers(
          exam.questions,
          (data.answers && typeof data.answers === 'object' ? data.answers : {}) as Record<string, string>,
        );
        const merged = { ...srv, ...localAns };
        if (Object.keys(merged).length > 0) setAnswers(merged);
        if (Array.isArray(data.flaggedQuestions) && data.flaggedQuestions.length > 0) {
          setFlaggedQuestions(data.flaggedQuestions);
        }
      } catch {
        const saved = safeLocalGet(`exam_answers_${exam.id}`);
        if (saved && !cancelled) {
          setAnswers(sanitizeExamAnswers(exam.questions, parseAnswersJson(saved)));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [exam.id, token, nextGuardHeaders, exam.questions]);

  useEffect(() => {
    safeLocalSet(`exam_answers_${exam.id}`, JSON.stringify(answers));
    safeLocalSet(`exam_answers_ts_${exam.id}`, String(Date.now()));
  }, [answers, exam.id]);

  useEffect(() => {
    if (banned) return;
    const id = window.setTimeout(() => {
      const body = JSON.stringify({ answers, flaggedQuestions });
      const attempt = async (n: number): Promise<void> => {
        try {
          const r = await fetch(apiUrl(`/api/student/exams/${exam.id}/save-progress`), {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(await nextGuardHeaders('POST', `/api/student/exams/${exam.id}/save-progress`)),
            },
            body,
          });
          syncVacIfOk(r);
          if (r.ok) {
            return;
          }
          if (n < 2 && (r.status >= 500 || r.status === 429)) {
            await new Promise((res) => setTimeout(res, 800 * (n + 1)));
            return attempt(n + 1);
          }
        } catch {
          if (n < 2) {
            await new Promise((res) => setTimeout(res, 800 * (n + 1)));
            return attempt(n + 1);
          }
        }
      };
      void attempt(0);
    }, 22000);
    return () => clearTimeout(id);
  }, [answers, flaggedQuestions, exam.id, token, banned, nextGuardHeaders]);

  useEffect(() => {
    if (banned) return;
    const sync = async () => {
      try {
        const res = await fetch(apiUrl(`/api/student/exams/${exam.id}/clock`), {
          headers: await nextGuardHeaders('GET', `/api/student/exams/${exam.id}/clock`),
        });
        syncVacIfOk(res);
        const data = await readJsonSafe<{ seconds_remaining?: number; proctorFeedLost?: boolean }>(res);
        if (res.ok && typeof data.seconds_remaining === 'number') {
          setTimeLeft((prev) => {
            const srv = data.seconds_remaining ?? 0;
            if (Math.abs(srv - prev) > 120) return srv;
            return prev;
          });
        }
        // Liveness: server nazorat kadrlari to'xtaganini aniqladi.
        if (res.ok && data.proctorFeedLost) {
          void logViolationRef.current('PROCTOR_FEED_LOST');
        }
      } catch {
        /* ignore */
      }
    };
    sync();
    const iv = window.setInterval(sync, 45000);
    return () => clearInterval(iv);
  }, [exam.id, token, banned, nextGuardHeaders]);

  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = t.leaveExamWarning;
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [t.leaveExamWarning]);

  // Fullscreen kirish vaqtini kuzatish (blur/fullscreenchange false positive oldini olish)
  const fullscreenRequestedRef = useRef(false);
  const fullscreenEnteredRef = useRef(false);
  const blurIgnoreUntilRef = useRef(0); // timestamp: shu vaqtgacha blur ignore qilinadi

  useEffect(() => {
    const ua = navigator.userAgent || '';
    if (/anydesk|teamviewer|rustdesk|splashtop/i.test(ua)) {
      void logViolationRef.current('REMOTE_CONTROL_SUSPECTED');
    }
    if ((navigator as any).webdriver) {
      void logViolationRef.current('REMOTE_CONTROL_SUSPECTED');
    }
    // Eslatma: maxTouchPoints + tor brauzer oynasi (masalan 900px) "mobil" deb noto'g'ri
    // REMOTE_CONTROL yuborardi — Windows sensorli noutbuklar tez-tez ban. Alohida yuborilmaydi.

    const clearBlurTimer = () => {
      if (blurViolationTimerRef.current !== null) {
        window.clearTimeout(blurViolationTimerRef.current);
        blurViolationTimerRef.current = null;
      }
    };

    // Blur: faqat fullscreen rejimida va fullscreen so'ralayotgan paytda emas
    const onBlur = () => {
      if (bannedRef.current) return;
      const now = Date.now();
      // Fullscreen so'ralayotgan paytda (2 soniya) blur ignore
      if (now < blurIgnoreUntilRef.current) return;
      clearBlurTimer();
      blurViolationTimerRef.current = window.setTimeout(() => {
        blurViolationTimerRef.current = null;
        if (bannedRef.current) return;
        if (document.hasFocus()) return;
        // Fullscreen bo'lmagan holatda blur ko'p false-positive beradi (OS popup, browser UI).
        // Shu sabab blur eventdan HARD violation yubormaymiz.
        if (!document.fullscreenElement) {
          return;
        }
        // Fullscreen rejimida blur — boshqa dastur focus oldi, lekin biz hali fullscreendamiz
        // Bu hard block emas — soft violation
        void logViolationRef.current('TAB_SWITCH_SOFT');
      }, 900);
    };

    // Fullscreen o'zgarishi
    const onFs = () => {
      if (bannedRef.current) return;
      if (document.fullscreenElement) {
        // Fullscreen kirildi — bu yaxshi
        fullscreenEnteredRef.current = true;
        fullscreenRequestedRef.current = false;
        clearBlurTimer();
        return;
      }
      // Fullscreen chiqildi
      if (!fullscreenEnteredRef.current) {
        // Hali fullscreanga kirmagan — ignore (boshlang'ich holat)
        return;
      }
      // Foydalanuvchi fullscreendan chiqdi — ogohlantirish, darhol ban emas
      void logViolationRef.current('FULLSCREEN_EXIT_HARD');
    };

    window.addEventListener('blur', onBlur);
    document.addEventListener('fullscreenchange', onFs);
    return () => {
      clearBlurTimer();
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('fullscreenchange', onFs);
    };
  }, []);

  const [qIndex, setQIndex] = useState(0);
  const answeredCount = Object.keys(answers).length;
  const totalQuestions = exam.questions.length;
  const progress = totalQuestions > 0 ? (answeredCount / totalQuestions) * 100 : 0;
  const currentQ = exam.questions[qIndex];
  const currentOptions = React.useMemo(
    () => normalizeQuestionOptions(currentQ?.options),
    [currentQ],
  );
  const currentQParsed = extractQuestionImages(cleanQuestionPrompt(currentQ?.text || ''));

  const videoRef = useRef<HTMLVideoElement>(null);
  const bannedRef = useRef(banned);
  const tokenRef = useRef(token);
  const examIdRef = useRef(exam.id);
  const answersRef = useRef(answers);
  const flaggedRef = useRef(flaggedQuestions);
  const submittingRef = useRef(false);
  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);
  useEffect(() => {
    flaggedRef.current = flaggedQuestions;
  }, [flaggedQuestions]);

  useEffect(() => {
    bannedRef.current = banned;
  }, [banned]);

  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  useEffect(() => {
    examIdRef.current = exam.id;
  }, [exam.id]);
  // Til faqat xato xabarlari uchun kerak — ref orqali (effekt dependency'siga qo'shilsa,
  // til almashtirilganda kamera/WebSocket/WebRTC butunlay qayta quriladi → proctoring uziladi).
  const langRef = useRef(lang);
  useEffect(() => {
    langRef.current = lang;
  }, [lang]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  
  const identityCheckBusyRef = useRef(false);
  const logViolationRef = useRef<(type: string) => Promise<void>>(async () => {});
  /** DevTools/clipboard/varaq — bir "urinish"da yuboriladigan bir nechta signal; bittasini yuborish. */
  const focusBurstLockUntilRef = useRef(0);
  const blurViolationTimerRef = useRef<number | null>(null);
  const hiddenViolationTimerRef = useRef<number | null>(null);
  const FOCUS_BURST_TYPES = new Set([
    'DEVTOOLS_OPEN',
    'CLIPBOARD_ATTEMPT',
    'TAB_SWITCH_HARD',
    'TAB_SWITCH_SOFT',
    'FULLSCREEN_EXIT_HARD',
  ]);
  const socketRef = useRef<RealtimeSocket | null>(null);
  const peerConnectionsRef = useRef<{ [id: string]: RTCPeerConnection }>({});

  // Kamera/mikrofonni TO'LIQ bo'shatish. Avval faqat track.stop() chaqirilardi —
  // bu haqiqiy uskunani o'chirsa ham, AudioContext ochiq qolgani sababli ba'zi
  // brauzerlarda kamera/mikrofon "band" indikatori yonib turishda davom etardi.
  const releaseCameraAndMic = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    analyserRef.current = null;
  }, []);

  // Imtihon TO'LIQ tugaganda (submit muvaffaqiyatli) — kamera/mikrofondan tashqari
  // WebRTC peer connection va WebSocket'ni ham darhol yopamiz (asosiy effekt cleanup'i
  // faqat komponent unmount bo'lganda yoki `banned` o'zgarganda ishlaydi — muvaffaqiyatli
  // submitdan keyin komponent AnimatePresence exit animatsiyasi davomida bir muddat
  // mount holida qolishi mumkin, shuning uchun bu yerda darhol tozalaymiz).
  // Ban holatida socket ATAYLAB yopilmaydi — admin "unblock" xabari shu orqali kelishi mumkin;
  // uni `banned` o'zgarganda asosiy effekt cleanup'i o'z vaqtida tozalaydi.
  const releaseAllExamResources = useCallback(() => {
    releaseCameraAndMic();
    Object.values(peerConnectionsRef.current).forEach((pc) => pc.close());
    peerConnectionsRef.current = {};
    socketRef.current?.destroy();
    socketRef.current = null;
  }, [releaseCameraAndMic]);

  const recoverCameraPreview = useCallback(() => {
    const v = videoRef.current;
    const s = streamRef.current;
    if (!v || !s) {
      setProctorRetryNonce((n) => n + 1);
      return;
    }
    if (v.srcObject !== s) v.srcObject = s;
    const vt = s.getVideoTracks()[0];
    if (!vt || vt.readyState !== 'live') {
      setProctorRetryNonce((n) => n + 1);
      return;
    }
    void v
      .play()
      .then(() => {
        setCameraPreviewOk(true);
        setCameraErrorHint('');
      })
      .catch(() => {
        setProctorRetryNonce((n) => n + 1);
      });
  }, []);

  useEffect(() => {
    if (banned) return;
    const id = window.setInterval(() => {
      if (bannedRef.current) return;
      const v = videoRef.current;
      const s = streamRef.current;
      const vt = s?.getVideoTracks?.()?.[0];
      if (!v || !s || !vt) return;
      if (vt.readyState !== 'live') {
        setCameraPreviewOk(false);
        setCameraErrorHint(translations[langRef.current].examCameraPlayBlocked);
        setProctorRetryNonce((n) => n + 1);
        return;
      }
      if (v.srcObject !== s) v.srcObject = s;
      if (v.readyState >= 2 && !v.paused) {
        if (!cameraPreviewOk) {
          setCameraPreviewOk(true);
          setCameraErrorHint('');
        }
      }
    }, 2500);
    return () => window.clearInterval(id);
  }, [banned, cameraPreviewOk]);

  useEffect(() => {
    if (banned) return;
    const s = streamRef.current;
    const v = videoRef.current;
      if (!s || !v) return;
    const tz = translations[langRef.current];
    if (v.srcObject !== s) v.srcObject = s;
    const tryPlay = () => {
      void v
        .play()
        .then(() => {
          setCameraPreviewOk(true);
          setCameraErrorHint('');
        })
        .catch(() => {
          setCameraPreviewOk(false);
          setCameraErrorHint(tz.examCameraPlayBlocked);
        });
    };
    tryPlay();
    v.addEventListener('loadeddata', tryPlay, { once: true });
    const t1 = window.setTimeout(tryPlay, 350);
    const t2 = window.setTimeout(tryPlay, 900);
    return () => {
      v.removeEventListener('loadeddata', tryPlay);
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [proctorStreamRevision, banned]);

  // --- AI Proctoring Setup & Security ---
  useEffect(() => {
    if (banned) return;

    // Security: Disable right click, copy/paste, and keyboard shortcuts (+ hard violation logging)
    const handleContextMenu = (e: Event) => {
      e.preventDefault();
      void logViolationRef.current('CLIPBOARD_ATTEMPT');
    };
    const handleCopyPaste = (e: Event) => {
      e.preventDefault();
      void logViolationRef.current('CLIPBOARD_ATTEMPT');
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      const key = (e.key || '').toLowerCase();
      const isClipboardCombo = (e.ctrlKey || e.metaKey) && ['c', 'v', 'x', 'a'].includes(key);
      const isDevtoolsCombo =
        key === 'f12' ||
        ((e.ctrlKey || e.metaKey) && e.shiftKey && ['i', 'j'].includes(key));
      if (key === 'printscreen') {
        e.preventDefault();
        void logViolationRef.current('PRINT_SCREEN');
        return;
      }
      if (isDevtoolsCombo) {
        e.preventDefault();
        const now = Date.now();
        if (
          now >= devtoolsShortcutCooldownUntilRef.current &&
          document.hasFocus() &&
          Boolean(document.fullscreenElement)
        ) {
          devtoolsShortcutCooldownUntilRef.current = now + 20_000;
          void logViolationRef.current('DEVTOOLS_OPEN');
        }
        return;
      }
      if (isClipboardCombo) {
        e.preventDefault();
        void logViolationRef.current('CLIPBOARD_ATTEMPT');
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) {
        e.preventDefault();
      }
    };

    document.addEventListener('contextmenu', handleContextMenu);
    document.addEventListener('copy', handleCopyPaste);
    document.addEventListener('paste', handleCopyPaste);
    document.addEventListener('cut', handleCopyPaste);
    document.addEventListener('keydown', handleKeyDown);

    let devtoolsTick: number | null = null;
    if (enableSizeHeuristicDevtools) {
      let consecutiveHits = 0;
      devtoolsTick = window.setInterval(() => {
        if (bannedRef.current) return;
        if (!document.fullscreenElement || !document.hasFocus()) {
          consecutiveHits = 0;
          return;
        }
        const dw = Math.abs((window.outerWidth || 0) - (window.innerWidth || 0));
        const dh = Math.abs((window.outerHeight || 0) - (window.innerHeight || 0));
        const suspicious = dw > 320 && dh > 180;
        consecutiveHits = suspicious ? consecutiveHits + 1 : 0;
        if (consecutiveHits >= 2) {
          consecutiveHits = 0;
          void logViolationRef.current('DEVTOOLS_OPEN');
        }
      }, 12_000);
    }

    // requestFullscreen faqat foydalanuvchi jesti (click/touch) bilan — useEffect o'zi "user gesture" emas
    const onFirstUserGesture = () => {
      if (document.fullscreenElement) {
        window.removeEventListener('pointerdown', onFirstUserGesture, true);
        return;
      }
      if (document.documentElement.requestFullscreen) {
        fullscreenRequestedRef.current = true;
        blurIgnoreUntilRef.current = Date.now() + 3000;
        void document.documentElement.requestFullscreen().then(
          () => {
            window.removeEventListener('pointerdown', onFirstUserGesture, true);
          },
          () => {
            fullscreenRequestedRef.current = false;
          }
        );
      } else {
        window.removeEventListener('pointerdown', onFirstUserGesture, true);
      }
    };
    window.addEventListener('pointerdown', onFirstUserGesture, { capture: true });

    const setupAI = async () => {
      try {
        setCameraErrorHint('');
        setCameraPreviewOk(false);
        const stream = await openPreferredProctorStream();
        streamRef.current = stream;
        setProctorStreamRevision((n) => n + 1);

        // Django Channels WebSocket (Node.js Socket.IO o'rniga)
        const wsUrl = buildRealtimeUrl(token);
        const wsInstance = createRealtimeSocket(
          wsUrl,
          async (msg) => {
            if (msg.type === 'connected') {
              wsInstance.send({ type: 'join_exam', exam_id: exam.id, role: 'student' });
              setRealtimeSyncOffline(false);
            } else if (msg.type === 'student_unblocked') {
              const md = msg as any;
              if (String(md.student_id) === String(user.id)) {
                if (md.can_retake) {
                  setBanned(false);
                  setStrikeLevel(0);
                  setViolationWarning(null);
                  setBanViolationsCount(null);
                  setProctorRetryNonce((n) => n + 1);
                  showWarningMsg(translations[langRef.current].unblockAllowedMsg || 'Admin imtihonni davom ettirishingizga ruxsat berdi!', 6000);
                } else {
                  showWarningMsg(translations[langRef.current].unblockDeniedMsg || 'Admin imtihonni tugatdi. Topshira olmaysiz.', 8000);
                }
              }
            } else if (msg.type === 'offer') {
              const fromId = msg.from as string;
              const offer = msg.offer as RTCSessionDescriptionInit;
              const pc = new RTCPeerConnection({
                iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
              });
              peerConnectionsRef.current[fromId] = pc;
              stream.getTracks().forEach((track) => pc.addTrack(track, stream));
              pc.onicecandidate = (ev) => {
                if (ev.candidate) {
                  wsInstance.send({
                    type: 'ice_candidate',
                    to: fromId,
                    candidate: ev.candidate.toJSON(),
                  });
                }
              };
              await pc.setRemoteDescription(new RTCSessionDescription(offer));
              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);
              wsInstance.send({ type: 'answer', to: fromId, answer });
            } else if (msg.type === 'ice_candidate') {
              const fromId = msg.from as string;
              const pc = peerConnectionsRef.current[fromId];
              if (pc) {
                await pc.addIceCandidate(
                  new RTCIceCandidate(msg.candidate as RTCIceCandidateInit),
                );
              }
            }
          },
          {
            onOpen: () => {
              setRealtimeSyncOffline(false);
              setRealtimeBannerDismissed(false);
            },
            onFailed: () => setRealtimeSyncOffline(true),
          },
        );
        socketRef.current = wsInstance;

        // 2. Setup Audio Analysis (mikrofon izlari bo'lmasa — ovoz tahlilini o'tkazib yuboramiz)
        if (stream.getAudioTracks().length > 0) {
          const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
          const analyser = audioCtx.createAnalyser();
          const source = audioCtx.createMediaStreamSource(stream);
          source.connect(analyser);
          // 2048: har bir o'qishda ~46ms (44.1kHz da) audio oynasi — kichikroq buferda (256 = ~5.8ms)
          // tez-tez so'rov qilinganda ham nutqning ko'p qismi "sample" oralig'idan chetda qolib ketardi.
          analyser.fftSize = 2048;
          audioContextRef.current = audioCtx;
          analyserRef.current = analyser;
        } else {
          audioContextRef.current = null;
          analyserRef.current = null;
        }

      } catch (err) {
        setCameraPreviewOk(false);
        if (err instanceof DOMException && err.message === VIRTUAL_CAMERA_BLOCKED_MESSAGE) {
          setCameraErrorHint(translations[langRef.current].virtualCameraBlocked);
          showWarningMsg(translations[langRef.current].virtualCameraBlocked, 8000);
          void logViolationRef.current('VIRTUAL_WEBCAM_SUSPECTED');
        } else {
          console.error('Failed to setup AI proctoring:', err);
          setCameraErrorHint(translations[langRef.current].examCameraPlayBlocked);
          void logViolationRef.current('CAMERA_MIC_ACCESS_FAILED');
        }
      }
    };

    setupAI();

    // Cleanup
    return () => {
      window.removeEventListener('pointerdown', onFirstUserGesture, true);
      document.removeEventListener('contextmenu', handleContextMenu);
      document.removeEventListener('copy', handleCopyPaste);
      document.removeEventListener('paste', handleCopyPaste);
      document.removeEventListener('cut', handleCopyPaste);
      document.removeEventListener('keydown', handleKeyDown);
      if (devtoolsTick !== null) clearInterval(devtoolsTick);
      
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }

      socketRef.current?.destroy();
      Object.values(peerConnectionsRef.current).forEach(pc => pc.close());

      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
      }
    };
  }, [banned, exam.id, token, user.id, proctorRetryNonce]);

  // --- Real-time ovoz faolligi (VAD) — RMS + zero-crossing, ~200ms da bir freym.
  //     (Avval 1000ms edi — bunda har o'qishda faqat ~5.8ms audio "suratga olinardi",
  //     ya'ni gapirishning katta qismi ikkita so'rov oralig'ida butunlay ko'rinmay qolardi.
  //     200ms + kattaroq fftSize tezroq va ishonchliroq ushlaydi.)
  const voiceTrackerRef = useRef<VoiceActivityTracker | null>(null);

  useEffect(() => {
    if (banned) return;
    const analyser = analyserRef.current;
    if (!analyser) return;
    if (!voiceTrackerRef.current) voiceTrackerRef.current = new VoiceActivityTracker();
    const id = window.setInterval(() => {
      if (bannedRef.current || !analyserRef.current) return;
      const frame = analyzeVoiceFrame(analyserRef.current);
      const signal = voiceTrackerRef.current?.push(frame);
      if (signal) void logViolationRef.current(signal);
    }, 200);
    return () => clearInterval(id);
  }, [banned, analyserRef.current]);

  const [identityTerminated, setIdentityTerminated] = useState(false);

  // --- Violation logging ---
  const logViolation = async (type: string) => {
    if (bannedRef.current) return;

    // Server: strict VAC da faqat IDENTITY_SUBSTITUTION darhol ban; qolganlari ogohlantirish ketma-ketligi.
    const INSTANT_BAN_TYPES = new Set(['IDENTITY_SUBSTITUTION']);

    // Modal ochiqligida yangi violationlar (IDENTITY_SUBSTITUTION dan tashqari) bloklansn —
    // talaba ogohlantirishni o'qib javob bergandan keyin davom etsin.
    if (warningModalShowingRef.current && !INSTANT_BAN_TYPES.has(type)) return;

    // Dedup: bir xil tur uchun qisqa interval (server 60s ichida bitta rasmiy ogohlantirishni birlashtiradi)
    const now = Date.now();
    if (FOCUS_BURST_TYPES.has(type) && now < focusBurstLockUntilRef.current) {
      return;
    }
    const dedupeKey = `viol_last_${type}`;
    const lastSent = parseInt(sessionStorage.getItem(dedupeKey) || '0', 10);
    const MIN_INTERVAL = INSTANT_BAN_TYPES.has(type) ? 0 : 5_000;
    if (MIN_INTERVAL > 0 && now - lastSent < MIN_INTERVAL) {
      return;
    }
    if (FOCUS_BURST_TYPES.has(type)) {
      focusBurstLockUntilRef.current = now + 4500;
    }
    sessionStorage.setItem(dedupeKey, String(now));

    try {
      const res = await fetch(apiUrl('/api/student/violations'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(await nextGuardHeaders('POST', '/api/student/violations')),
        },
        body: JSON.stringify({
          exam_id: examIdRef.current,
          violation_type: type,
        }),
      });
      syncVacIfOk(res);
      const data = (await readJsonSafe<{
        error?: string;
        code?: string;
        violationsCount?: number;
        banned?: boolean;
        warningNumber?: number;
        violationReason?: string;
        isFinalWarning?: boolean;
        warningSuppressed?: boolean;
        startupGrace?: boolean;
        officialWarnings?: number;
        mergeWindowSeconds?: number;
      }>(res)) || {};

      if (!res.ok) {
        const hint = data.violationReason || data.error || data.code || `HTTP ${res.status}`;
        showWarningMsg(String(hint), 5000);
        return;
      }

      // Startup grace (kamera qizishi, ~40s) — rasmiy ogohlantirish emas (false-positive),
      // shuning uchun strike hisoblanmaydi, faqat yengil xabar modali ko'rsatiladi.
      if (data.startupGrace) {
        const detail = (data.violationReason || type).trim();
        showWarningMsg(detail, 5000);
        return;
      }

      if (data.banned) {
        if (type === 'IDENTITY_SUBSTITUTION') setIdentityTerminated(true);
        setViolationWarning(null);
        setStrikeLevel(3);
        if (typeof data.violationsCount === 'number') {
          setBanViolationsCount(data.violationsCount);
        } else {
          setBanViolationsCount(null);
        }
        setBanned(true);
        releaseCameraAndMic();
        return;
      }

      // Barcha boshqa qoidabuzarliklar — DOIM modal ko'rsatamiz (suppressed/merged bo'lsa ham).
      const official = typeof data.officialWarnings === 'number' ? data.officialWarnings : 0;
      const shownNumber =
        typeof data.warningNumber === 'number' && data.warningNumber > 0
          ? data.warningNumber
          : Math.max(1, official);
      setStrikeLevel(official > 0 ? official : shownNumber);
      warningModalShowingRef.current = true;
      setViolationWarning({
        reason: data.violationReason || type,
        warningNumber: shownNumber,
        isFinalWarning: data.isFinalWarning === true,
      });
    } catch {
      // Tarmoq xatosi — local state
      showWarningMsg(type, 3000);
    }
  };

  logViolationRef.current = logViolation;

  // --- Server-side kadr tahlili (har 20s, avtoritativ tasdiq) ---
  useServerProctoring({
    examId: exam.id,
    videoRef,
    guardHeadersFn: nextGuardHeaders,
    onViolations: (types) => {
      for (const t of types) void logViolationRef.current(t);
    },
    intervalMs: 20_000,
    disabled: banned,
  });

  // --- Real-time brauzer proctoring (MediaPipe): gaze/bosh burilishi, qimirlash,
  //     qo'l/imo-ishora, ko'p yuz, yuz yo'q, pozitsiya. Server proctoring bilan gibrid ishlaydi. ---
  useRealtimeProctoring({
    videoRef,
    streamRevision: proctorStreamRevision,
    disabled: banned,
    onViolation: (type) => void logViolationRef.current(type),
    onRecheckIdentity: () => triggerIdentityCheckRef.current(),
    onFaceStatus: setFaceStatus,
  });

  // --- Periodic identity match (Gemini serverda) ---
  // TOKEN TEJASH:
  // - 90 soniyada bir marta (avval 45s edi)
  // - Rasm: 280x210, quality=0.55 (avval full res, quality=0.85 edi)
  // - Faqat yuz aniqlanganida (singleFace=true)
  // - Ketma-ket 3 ta muvaffaqiyatsiz bo'lsa blok (yolg'on positive kamaytirish)
  const identityFailCountRef = useRef(0);
  // Real-time engine person-swap shubhasida darhol identity tekshiruvini ishga tushiradi.
  const triggerIdentityCheckRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (banned || !user.profile_image) return;

    const setIdStatus = (s: 'idle' | 'checking' | 'ok' | 'fail') => {
      if (identityStatusTimerRef.current !== null) {
        clearTimeout(identityStatusTimerRef.current);
        identityStatusTimerRef.current = null;
      }
      setIdentityStatus(s);
      // 'ok'/'fail' ko'rsatilgach 2.5s da 'idle' ga qaytadi
      if (s === 'ok' || s === 'fail') {
        identityStatusTimerRef.current = window.setTimeout(() => {
          setIdentityStatus('idle');
          identityStatusTimerRef.current = null;
        }, 2500);
      }
    };

    const runCheck = async () => {
      if (bannedRef.current || identityCheckBusyRef.current) return;
      const video = videoRef.current;
      if (!video || video.readyState < 2) return;

      identityCheckBusyRef.current = true;
      setIdStatus('checking');
      try {
        const liveDataUrl = compressVideoFrameToJpeg(video, 0.55, 280);
        if (!liveDataUrl) { setIdStatus('idle'); return; }
        const liveB64 = liveDataUrl.split(',')[1];
        const prof = String(user.profile_image);

        const res = await fetch(apiUrl('/api/student/identity-compare'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(await nextGuardHeaders('POST', '/api/student/identity-compare')),
          },
          body: JSON.stringify({
            exam_id: examIdRef.current,
            profile_image_base64: prof,
            live_capture_base64: liveB64,
          }),
        });
        syncVacIfOk(res);

        if (res.status === 503 || res.status === 429) {
          identityFailCountRef.current = 0;
          setIdStatus('idle');
          return;
        }
        if (!res.ok) { setIdStatus('idle'); return; }

        const data = (await readJsonSafe<{ match?: boolean }>(res)) || {};
        if (!data.match) {
          identityFailCountRef.current += 1;
          setIdStatus('fail');
          if (identityFailCountRef.current >= 3) {
            await logViolationRef.current('IDENTITY_SUBSTITUTION');
          }
        } else {
          identityFailCountRef.current = 0;
          setIdStatus('ok');
        }
      } catch {
        setIdStatus('idle');
      } finally {
        identityCheckBusyRef.current = false;
      }
    };

    triggerIdentityCheckRef.current = () => { void runCheck(); };
    const id = window.setInterval(runCheck, IDENTITY_CHECK_MS);
    void runCheck();
    return () => {
      clearInterval(id);
      if (identityStatusTimerRef.current !== null) clearTimeout(identityStatusTimerRef.current);
    };
  }, [banned, user.profile_image, nextGuardHeaders]);

  // --- Tab / visibility (masofaviy nazorat) ---
  useEffect(() => {
    const clearHiddenTimer = () => {
      if (hiddenViolationTimerRef.current !== null) {
        window.clearTimeout(hiddenViolationTimerRef.current);
        hiddenViolationTimerRef.current = null;
      }
    };

    const onVis = () => {
      if (bannedRef.current) return;
      // Modal yopilgandan keyingi qisqa grace oynasi — xuddi `onBlur`dagi kabi (bir xil
      // blurIgnoreUntilRef). Aks holda ogohlantirish modalini yopish paytidagi tasodifiy
      // visibility tebranishi yolg'on TAB_SWITCH_SOFT chiqarardi.
      if (Date.now() < blurIgnoreUntilRef.current) return;
      if (document.visibilityState === 'hidden') {
        // Qisqa hidden holatlari false positive bermasligi uchun delay.
        clearHiddenTimer();
        hiddenViolationTimerRef.current = window.setTimeout(() => {
          hiddenViolationTimerRef.current = null;
          if (bannedRef.current) return;
          if (document.visibilityState === 'hidden') {
            void logViolationRef.current('TAB_SWITCH_SOFT');
          }
        }, 1200);
      } else {
        clearHiddenTimer();
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearHiddenTimer();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  const runSubmitCore = useCallback(
    async (ans: Record<string, string>, fl: number[]) => {
      if (submittingRef.current || bannedRef.current) return;
      if (isOffline) {
        showWarningMsg(t.offlineSubmit, 4000);
        return;
      }
      submittingRef.current = true;
      setSubmitting(true);
      try {
        const res = await fetch(apiUrl(`/api/student/exams/${exam.id}/submit`), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(await nextGuardHeaders('POST', `/api/student/exams/${exam.id}/submit`)),
          },
          body: JSON.stringify({ answers: ans, flaggedQuestions: fl }),
        });
        syncVacIfOk(res);
        const json = await readJsonSafe<ExamResultPayload & { error?: string }>(res);
        if (!res.ok) {
          showWarningMsg(String(json?.error || t.submitError), 5000);
          submittingRef.current = false;
          setSubmitting(false);
          return;
        }
        if (!json?.result_public_id || !Array.isArray(json.questions)) {
          showWarningMsg(t.submitError, 5000);
          submittingRef.current = false;
          setSubmitting(false);
          return;
        }
        safeLocalRemove(`exam_answers_${exam.id}`);
        safeLocalRemove(`exam_answers_ts_${exam.id}`);
        releaseAllExamResources();
        const payload: ExamResultPayload = {
          exam_id: json.exam_id,
          result_public_id: json.result_public_id,
          verify_url: json.verify_url,
          overview: json.overview ?? '',
          questions: json.questions,
          score: json.score,
          total: json.total,
          integrity_code: json.integrity_code,
          percentage: json.percentage,
          completed_at: json.completed_at,
          exam_title: exam.title,
          student_name: user.name || user.id,
        };
        onFinish(payload);
      } catch (err) {
        console.error('Failed to submit', err);
        showWarningMsg(t.submitError, 5000);
        submittingRef.current = false;
        setSubmitting(false);
      }
    },
    [exam.id, exam.title, token, user.name, user.id, onFinish, isOffline, t.offlineSubmit, t.submitError, nextGuardHeaders, releaseAllExamResources]
  );

  const handleSubmit = () => runSubmitCore(answersRef.current, flaggedRef.current);

  // Vaqt tugaganda darhol topshirish (sahifa yuklanganda ham)
  useEffect(() => {
    if (banned || submittingRef.current) return;
    if (timeLeft <= 0) {
      void runSubmitCore(answersRef.current, flaggedRef.current);
    }
  }, [banned, timeLeft, runSubmitCore]);

  // --- Countdown (oxirgi javoblar ref orqali) ---
  useEffect(() => {
    if (banned) return;
    const timer = window.setInterval(() => {
      setTimeLeft((prev) => {
        if (prev === 300) {
          setShowTimeWarning(true);
          window.setTimeout(() => setShowTimeWarning(false), 5000);
        }
        if (prev <= 1) {
          window.clearInterval(timer);
          void runSubmitCore(answersRef.current, flaggedRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [banned, runSubmitCore]);

  // Bloklovchi modal (rasmiy ogohlantirish yoki ban) ochiq bo'lsa, navbatdagi xabar
  // ekranda ko'rinmaydi (ikkalasi ham markazda, balandroq z-index yopib qo'yadi) —
  // shuning uchun taymer FAQAT bloklovchi modal yo'qolgach boshlanadi. Aks holda xabar
  // hech qachon ko'rinmasdan turib taymer bilan sukut saqlab yo'qolib ketardi.
  const warningBlocked = Boolean(violationWarning) || banned || hardBlocked;
  useEffect(() => {
    if (warningBlocked) return;
    const current = warningQueue[0];
    if (!current) return;
    const timer = window.setTimeout(() => dismissWarningMsg(current.id), current.duration);
    return () => window.clearTimeout(timer);
  }, [warningBlocked, warningQueue, dismissWarningMsg]);

  // Har uch overlay holatida ham (ogohlantirish/ban/umumiy) ko'rinishi kerak —
  // pastdagi ikkita early-return asosiy JSX daraxtini almashtirib yuboradi,
  // shuning uchun bu modalni alohida hisoblab, har bir branchga qo'shib chiqamiz.
  const activeWarningMsg = warningBlocked ? undefined : warningQueue[0];
  const warningMsgModal = activeWarningMsg
    ? createPortal(
        <div
          className="fixed inset-0 z-[10040] flex items-center justify-center bg-black/50 overflow-y-auto overscroll-y-contain px-4 py-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="warning-msg-title"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            className="w-full max-w-md rounded-lg sm:rounded-xl border-2 border-red-400 bg-red-50 shadow-2xl p-5 sm:p-7 text-center"
          >
            <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 sm:w-9 sm:h-9 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
            </div>
            <h2 id="warning-msg-title" className="text-lg sm:text-xl font-bold text-red-700 mb-2">{t.proctorWarningTitle}</h2>
            <p className="text-sm sm:text-base font-medium text-gray-800 break-words mb-5">{activeWarningMsg.text}</p>
            <button
              type="button"
              onClick={() => {
                // Xuddi rasmiy ogohlantirish modalidagi kabi — modal yopilgandan keyingi
                // qisqa fokus/visibility tebranishi yolg'on TAB_SWITCH bermasin.
                blurIgnoreUntilRef.current = Date.now() + 2000;
                dismissWarningMsg(activeWarningMsg.id);
              }}
              className="w-full py-3 rounded-xl sm:rounded-lg font-semibold text-sm sm:text-base bg-red-600 hover:bg-red-700 text-white transition-all active:scale-[0.98]"
            >
              {t.violationContinueExam}
            </button>
          </motion.div>
        </div>,
        document.body,
      )
    : null;

  // --- Ogohlantirish modal (ban emas, davom etish mumkin) ---
  if (violationWarning && !banned && !hardBlocked) {
    const isFinal = violationWarning.isFinalWarning;
    const warnNum = violationWarning.warningNumber;
    // MAX_WARNINGS_BEFORE_BAN = 3; 3-chida ban, shuning uchun circles 3 ta
    const MAX_W = 3;
    const remaining = Math.max(0, MAX_W - warnNum);

    const warnTitle = t.violationWarningTitle.replace('{n}', String(warnNum));
    const warnContinue = t.violationContinueExam;
    const reasonLabel = t.violationReasonLabel;

    return <>{createPortal(
      <div
        className="fixed inset-0 z-[10050] flex items-center justify-center bg-black/60 overflow-y-auto overscroll-y-contain px-4 py-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="violation-warn-title"
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 320, damping: 28 }}
          className={`w-full max-w-lg max-h-[min(90dvh,calc(100dvh-2rem))] flex flex-col min-h-0 rounded-lg sm:rounded-xl border-2 shadow-2xl ${
            isFinal ? 'border-red-400 bg-red-50' : 'border-orange-400 bg-orange-50'
          }`}
        >
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain p-5 sm:p-7">
            <div className={`w-12 h-12 sm:w-16 sm:h-16 rounded-full flex items-center justify-center mx-auto mb-4 sm:mb-5 ${isFinal ? 'bg-red-100' : 'bg-orange-100'}`}>
              <svg className={`w-7 h-7 sm:w-9 sm:h-9 ${isFinal ? 'text-red-600' : 'text-orange-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5}
                  d="M12 9v3m0 3h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
            </div>

            <h2 id="violation-warn-title" className={`text-lg sm:text-xl font-bold text-center mb-2 leading-snug ${isFinal ? 'text-red-700' : 'text-orange-700'}`}>
              {warnTitle}
            </h2>

            {/* Countdown banner */}
            <div className={`rounded-lg px-3 py-2 mb-4 text-center text-sm font-semibold ${
              isFinal
                ? 'bg-red-600 text-white'
                : 'bg-orange-100 text-orange-800 border border-orange-300'
            }`}>
              {isFinal
                ? '⛔ Keyingi qoidabuzarlikda BLOKLANSIZ!'
                : `⚠ Yana ${remaining} ta ogohlantirish qoldi — bloklansiz!`}
            </div>

            <div className="bg-white rounded-xl sm:rounded-lg px-4 py-3 sm:px-5 sm:py-4 mb-4 text-center border border-gray-200">
              <p className="text-[10px] sm:text-xs text-gray-500 mb-1 uppercase tracking-wide font-medium">{reasonLabel}</p>
              <p className="text-sm sm:text-base font-semibold text-gray-800 break-words">{violationWarning.reason}</p>
            </div>

            <div className="flex justify-center gap-2 sm:gap-3 mb-4">
              {[1, 2, 3].map((n) => (
                <div
                  key={n}
                  className={`w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center text-xs sm:text-sm font-bold border-2 transition-all ${
                    n <= warnNum
                      ? isFinal
                        ? 'bg-red-100 text-red-700 border-red-400'
                        : 'bg-orange-100 text-orange-700 border-orange-400'
                      : 'bg-gray-100 text-gray-400 border-gray-200'
                  }`}
                >
                  {n <= warnNum ? '!' : n}
                </div>
              ))}
            </div>

            <p className="text-[11px] sm:text-xs text-gray-500 text-center mb-4 sm:mb-5 leading-relaxed">{t.violationFooterHonest}</p>
          </div>

          <div className="shrink-0 border-t border-black/5 p-4 sm:p-5 pt-3 sm:pt-4 bg-white rounded-b-2xl sm:rounded-b-3xl">
            <button
              type="button"
              onClick={() => {
                warningModalShowingRef.current = false;
                // Modal yopilgandan keyin 2 soniya blur ignore — yolg'on TAB_SWITCH oldini oladi
                blurIgnoreUntilRef.current = Date.now() + 2000;
                setViolationWarning(null);
                recoverCameraPreview();
              }}
              className={`w-full py-3 sm:py-3.5 rounded-xl sm:rounded-lg font-semibold text-sm sm:text-base transition-all active:scale-[0.98] text-white ${
                isFinal ? 'bg-red-600 hover:bg-red-700' : 'bg-orange-500 hover:bg-orange-600'
              }`}
            >
              {warnContinue}
            </button>
          </div>
        </motion.div>
      </div>,
      document.body,
    )}{warningMsgModal}</>;
  }

  // --- Ban ekrani (to'liq bloklash) ---
  if (banned || hardBlocked) {
    const banTitle = t.examEndedTitle;
    const banMsg = identityTerminated ? t.examTerminatedIdentity : t.examTerminatedWarnings;
    const banPdfLabel = t.banReportDownload;
    const backLabel = t.banBackToDashboard;

    return <>{createPortal(
      <div
        className="fixed inset-0 z-[10050] flex items-center justify-center bg-black/50 overflow-y-auto overscroll-y-contain px-4 py-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ban-ended-title"
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-lg my-auto"
        >
          <div className="w-full text-center p-6 sm:p-8 max-h-[min(92dvh,100dvh-1rem)] overflow-y-auto overscroll-y-contain rounded-lg border border-red-200 bg-red-50/95 shadow-2xl shadow-red-500/10">
          <div className="w-20 h-20 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
          </div>
          <h2 id="ban-ended-title" className="text-2xl font-bold text-red-600 mb-3 tracking-tight">{banTitle}</h2>
          <p className="text-gray-700 mb-4 leading-relaxed text-sm">{banMsg}</p>
          {banViolationsCount != null && (
            <p className="text-sm text-red-800/90 font-medium mb-5">
              {t.banRecordCountHint.replace('{n}', String(banViolationsCount))}
            </p>
          )}

          <div className="space-y-2.5">
            <AdminBtn
              variant="red"
              size="lg"
              className="w-full"
              loading={banPdfBusy}
              onClick={async () => {
                try {
                  setBanPdfBusy(true);
                  const res = await fetch(apiUrl(`/api/student/ban-report.pdf?exam_id=${exam.id}`), {
                    headers: examAuthHeaders(token),
                  });
                  if (!res.ok) throw new Error('yuklab bo\'lmadi');
                  const blob = await res.blob();
                  const url = window.URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `BAN_REPORT_${user.id}.pdf`;
                  a.click();
                  window.URL.revokeObjectURL(url);
                } catch (e) {
                  console.error(e);
                } finally {
                  setBanPdfBusy(false);
                }
              }}
            >
              {banPdfBusy ? t.downloading : banPdfLabel}
            </AdminBtn>
            <AdminBtn variant="ghost" size="lg" className="w-full" onClick={() => onFinish(null)}>
              {backLabel}
            </AdminBtn>
          </div>
          <div className="mt-5 border-t border-red-200/70 pt-5 text-left space-y-3">
            <p className="text-[13px] font-semibold text-gray-800">{lang === 'ru' ? 'Обжалование бана' : lang === 'en' ? 'Appeal BAN' : "BAN bo'yicha murojaat"}</p>
            <textarea
              value={appealReason}
              onChange={(e) => setAppealReason(e.target.value)}
              placeholder={lang === 'ru' ? 'Опишите ситуацию подробно (мин. 12 симв.) — admin рассмотрит' : lang === 'en' ? 'Describe the situation in detail (min 12 chars) — admin will review' : "Vaziyatni batafsil yozing (kamida 12 belgi) — admin ko'rib chiqadi"}
              className="w-full min-h-[80px] rounded-lg border border-gray-200 bg-white px-3 py-2 text-[13px] resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500/25 focus:border-indigo-500 transition-colors"
            />
            {/* Placeholder yozilgach yo'qoladi — tugma nega o'chiqligi ko'rinmay qolmasin uchun doimiy hisoblagich. */}
            <p className={`text-[11px] text-right ${appealReason.trim().length >= 12 ? 'text-emerald-600' : 'text-gray-400'}`}>
              {appealReason.trim().length}/12{' '}
              {lang === 'ru' ? 'символов (минимум)' : lang === 'en' ? 'characters (minimum)' : 'belgi (kamida)'}
            </p>
            {appealMsg ? (
              <AdminAlert type={appealMsg.startsWith('ok:') ? 'success' : 'error'}>
                {appealMsg.startsWith('ok:') ? appealMsg.slice(3) : appealMsg}
              </AdminAlert>
            ) : null}
            <AdminBtn
              variant="ghost"
              size="lg"
              className="w-full"
              loading={appealBusy}
              disabled={appealReason.trim().length < 12}
              onClick={async () => {
                try {
                  setAppealBusy(true);
                  setAppealMsg('');
                  const res = await fetch(apiUrl('/api/student/ban-appeals'), {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      ...examAuthHeaders(token),
                    },
                    body: JSON.stringify({
                      exam_id: exam.id,
                      reason: appealReason.trim(),
                    }),
                  });
                  const data = await readJsonSafe<{ error?: string }>(res);
                  if (!res.ok) {
                    setAppealMsg(data?.error || 'Murojaat yuborishda xatolik');
                    return;
                  }
                  setAppealMsg('ok:Murojaat yuborildi. Admin ko\'rib chiqadi.');
                  setAppealReason('');
                } finally {
                  setAppealBusy(false);
                }
              }}
            >
              {appealBusy ? (lang === 'ru' ? 'Отправка...' : lang === 'en' ? 'Sending...' : 'Yuborilmoqda...') : (lang === 'ru' ? 'Отправить обжалование' : lang === 'en' ? 'Submit appeal' : 'Murojaat yuborish')}
            </AdminBtn>
          </div>
        </div>
        </motion.div>
      </div>,
      document.body,
    )}{warningMsgModal}</>;
  }

  // --- Yuz holati overlay konfiguratsiyasi ---
  const FACE_STATUS_CFG: Record<FaceStatusLive, { label: string; border: string; bg: string; text: string; icon: string }> = {
    OK:             { label: 'Yuz aniq',          border: 'border-green-400',  bg: 'bg-green-500/90',  text: 'text-white', icon: '✓' },
    WAITING:        { label: 'Kamera tayyor...',   border: 'border-gray-300',   bg: 'bg-gray-700/80',   text: 'text-white', icon: '⋯' },
    NO_FACE:        { label: 'Yuz ko\'rinmayapti', border: 'border-red-500',    bg: 'bg-red-600/90',    text: 'text-white', icon: '⚠' },
    MULTIPLE_FACES: { label: 'Bir nechta yuz!',   border: 'border-red-500',    bg: 'bg-red-600/90',    text: 'text-white', icon: '⚠' },
    TOO_FAR:        { label: 'Yaqinroq o\'ting',   border: 'border-amber-400',  bg: 'bg-amber-500/90',  text: 'text-white', icon: '↔' },
    TOO_CLOSE:      { label: 'Uzoqroq toring',     border: 'border-amber-400',  bg: 'bg-amber-500/90',  text: 'text-white', icon: '↔' },
    OFF_CENTER:     { label: 'Markazga o\'ting',   border: 'border-amber-400',  bg: 'bg-amber-500/90',  text: 'text-white', icon: '⊕' },
    TURNED:         { label: 'Kameraga qarang',    border: 'border-orange-400', bg: 'bg-orange-500/90', text: 'text-white', icon: '↻' },
    GAZE_AWAY:      { label: 'Kameraga qarang',    border: 'border-orange-400', bg: 'bg-orange-500/90', text: 'text-white', icon: '👁' },
  };

  const toggleFlag = (qId: number) => {
    setFlaggedQuestions(prev => 
      prev.includes(qId) ? prev.filter(id => id !== qId) : [...prev, qId]
    );
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex flex-col lg:flex-row gap-8 p-4 md:p-8 max-w-7xl mx-auto">
      {/* Main Exam Area */}
      <motion.div 
        variants={container}
        initial="hidden"
        animate="show"
        className="flex-1 space-y-8"
      >
        <motion.div variants={item} className="sticky top-24 z-40 flex flex-col sm:flex-row justify-between items-start sm:items-center bg-white p-5 rounded-xl shadow-sm border border-gray-200 gap-4">
          <div className="flex-1 w-full">
            <h1 className="text-2xl font-bold tracking-tight text-gray-900 mb-2">{exam.title}</h1>
            <div className="flex items-center gap-3">
              <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                <div className="h-full bg-indigo-500 transition-all duration-500 ease-out" style={{ width: `${progress}%` }} />
              </div>
              <span className="text-xs font-medium text-gray-500 whitespace-nowrap">
                {t.questionProgress
                  .replace('{cur}', String(qIndex + 1))
                  .replace('{total}', String(totalQuestions))
                  .replace('{answered}', String(answeredCount))}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-6 w-full sm:w-auto justify-between sm:justify-end">
            <div className={`flex flex-col items-end ${timeLeft < 300 ? 'text-red-600' : 'text-gray-700'}`}>
              <span className="text-xs font-medium uppercase tracking-wider opacity-70">{t.timeRemaining}</span>
              <span className="font-mono text-2xl font-bold tracking-tight">
                {formatTime(timeLeft)}
              </span>
            </div>
            <AdminBtn variant="blue" size="lg" loading={submitting} onClick={handleSubmit} className="px-6 shrink-0">
              {submitting ? t.submitting : t.submitExam}
            </AdminBtn>
          </div>
        </motion.div>

        <AnimatePresence>
          {timeLeft <= 0 && (
            <motion.div
              initial={{ opacity: 0, y: -12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              className="bg-red-500/10 border border-red-400/30 text-red-800 px-6 py-4 rounded-lg shadow-sm text-sm font-medium"
            >
              {t.examTimeExpiredHint}
            </motion.div>
          )}
          {showTimeWarning && (
            <motion.div 
              initial={{ opacity: 0, y: -20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-orange-500/10 border border-orange-500/20 text-orange-700 px-6 py-4 rounded-lg relative flex items-center gap-3 shadow-sm"
            >
              <svg className="w-6 h-6 text-orange-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              <div>
                <strong className="font-semibold block">{t.timeWarningTitle}</strong>
                {t.timeWarningBody.trim() ? <span className="text-sm">{t.timeWarningBody}</span> : null}
              </div>
            </motion.div>
          )}
          {isOffline && (
            <motion.div 
              initial={{ opacity: 0, y: -20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-yellow-500/10 border border-yellow-500/20 text-yellow-700 px-6 py-4 rounded-lg relative flex items-center gap-3 shadow-sm"
            >
              <svg className="w-6 h-6 text-yellow-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
              <div>
                <strong className="font-semibold block">{t.connectionLostTitle}</strong>
                {t.connectionLostBody.trim() ? <span className="text-sm">{t.connectionLostBody}</span> : null}
              </div>
            </motion.div>
          )}
          {!isOffline && realtimeSyncOffline && !realtimeBannerDismissed && (
            <motion.div
              initial={{ opacity: 0, y: -20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-amber-50 border border-amber-200 text-amber-950 px-5 py-4 rounded-lg shadow-sm flex items-start gap-3"
            >
              <svg className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              <div className="flex-1 min-w-0">
                <strong className="font-semibold block text-sm">{t.realtimeSyncOfflineTitle}</strong>
                <span className="text-sm text-amber-900/90">{t.realtimeSyncOfflineBodyShort}</span>
                <div className="flex flex-wrap gap-2 mt-3">
                  <button
                    type="button"
                    className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-amber-600 text-white hover:bg-amber-700 transition"
                    onClick={() => {
                      setRealtimeBannerDismissed(false);
                      setProctorRetryNonce((n) => n + 1);
                    }}
                  >
                    {t.realtimeSyncRetry}
                  </button>
                  <button
                    type="button"
                    className="text-xs font-medium px-3 py-1.5 rounded-lg border border-amber-300 text-amber-900 hover:bg-amber-100 transition"
                    onClick={() => setRealtimeBannerDismissed(true)}
                  >
                    {t.realtimeSyncDismiss}
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {warningMsgModal}

        <div className="space-y-6 pb-20">
          {currentQ && (
            <motion.div variants={item} key={currentQ.id} id={`question-${currentQ.id}`}>
              <div className={`rounded-lg border bg-white overflow-hidden transition-all ${flaggedQuestions.includes(currentQ.id) ? 'border-amber-300 ring-2 ring-amber-200' : 'border-gray-200'}`}>
                <div className="bg-gray-50/80 border-b border-gray-100 px-5 py-4 flex items-start justify-between gap-3">
                  <p className="text-[15px] font-medium leading-relaxed text-gray-900 flex-1">
                    <span className="text-indigo-600 font-bold mr-2">{qIndex + 1}.</span>
                    {currentQParsed.cleanText || currentQ.text}
                  </p>
                  <button
                    type="button"
                    onClick={() => toggleFlag(currentQ.id)}
                    className={`shrink-0 ml-3 p-2 rounded-lg transition-colors ${flaggedQuestions.includes(currentQ.id) ? 'bg-amber-100 text-amber-600' : 'bg-gray-100 text-gray-400 hover:bg-gray-200'}`}
                    title={t.flagQuestion}
                  >
                    <svg className="w-4.5 h-4.5" fill={flaggedQuestions.includes(currentQ.id) ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9" /></svg>
                  </button>
                </div>
                <div className="p-4 sm:p-5 space-y-2.5">
                  {currentQParsed.images.map((img, idx) => (
                    <div key={`${currentQ.id}-img-${idx}`} className="mb-3">
                      <img
                        src={img}
                        alt={`Question ${qIndex + 1} image ${idx + 1}`}
                        className="max-h-72 w-auto rounded-xl border border-slate-200"
                        referrerPolicy="no-referrer"
                      />
                    </div>
                  ))}
                  {currentOptions.map((opt: string, optIndex: number) => (
                    <label
                      key={`${currentQ.id}-opt-${optIndex}`}
                      className={`flex items-center gap-4 p-4 rounded-lg cursor-pointer transition-all duration-200 border ${
                        answers[String(currentQ.id)] === opt
                          ? 'bg-indigo-50 border-indigo-300 shadow-sm ring-1 ring-indigo-200'
                          : 'bg-white border-slate-200 hover:border-indigo-200 hover:bg-indigo-50/40'
                      }`}
                    >
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 text-sm font-bold transition-colors ${
                        answers[String(currentQ.id)] === opt
                          ? 'bg-indigo-600 text-white'
                          : 'bg-slate-100 text-slate-600'
                      }`}>
                        {optionLetter(optIndex)}
                      </div>
                      <input
                        type="radio"
                        name={`q-${currentQ.id}`}
                        value={opt}
                        checked={answers[String(currentQ.id)] === opt}
                        onChange={() =>
                          setAnswers((prev) => ({
                            ...prev,
                            [String(currentQ.id)]: opt,
                          }))
                        }
                        className="sr-only"
                      />
                      <span className={`text-[15px] leading-snug flex-1 ${answers[String(currentQ.id)] === opt ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>
                        {opt}
                      </span>
                    </label>
                  ))}
                  {currentOptions.length === 0 && (
                    <AdminAlert type="error">{t.examOptionsMissing}</AdminAlert>
                  )}
                </div>
              </div>
            </motion.div>
          )}
          <div className="flex gap-3 justify-between items-center">
            <AdminBtn
              variant="ghost"
              size="lg"
              disabled={qIndex <= 0}
              onClick={() => setQIndex((i) => Math.max(0, i - 1))}
              icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>}
            >
              {t.examNavPrev}
            </AdminBtn>
            <AdminBtn
              variant="blue"
              size="lg"
              disabled={qIndex >= totalQuestions - 1}
              onClick={() => setQIndex((i) => Math.min(totalQuestions - 1, i + 1))}
              iconRight={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>}
            >
              {t.examNavNext}
            </AdminBtn>
          </div>

          {/* Har safar tepaga qaytmasdan topshirish mumkin bo'lsin — sahifa pastida ham tugma. */}
          <div className="pt-2 flex justify-end">
            <AdminBtn
              variant="blue"
              size="md"
              loading={submitting}
              onClick={handleSubmit}
              className="px-6"
            >
              {submitting ? t.submitting : t.submitExam}
            </AdminBtn>
          </div>
        </div>
      </motion.div>

      {/* Proctoring Sidebar */}
      <motion.div 
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.3, type: "spring", stiffness: 300, damping: 30 }}
        className="w-full lg:w-80 space-y-6 lg:sticky lg:top-24 h-fit"
      >
        {(() => {
          const fsCfg = FACE_STATUS_CFG[faceStatus] ?? FACE_STATUS_CFG.WAITING;
          const isOk = faceStatus === 'OK';
          const isWaiting = faceStatus === 'WAITING';
          return (
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full shrink-0 ${isOk ? 'bg-green-500' : 'bg-red-500 animate-pulse'}`} />
                <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">{t.examPanelCamera}</span>
              </div>
              <div className="p-2">
                <div className={`rounded-lg overflow-hidden bg-black/5 border-2 shadow-inner relative aspect-video transition-colors duration-300 ${fsCfg.border}`}>
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    onLoadedMetadata={() => {
                      if (videoRef.current && videoRef.current.videoWidth > 0) {
                        setCameraPreviewOk(true);
                        setCameraErrorHint('');
                      }
                    }}
                    onPlaying={() => {
                      setCameraPreviewOk(true);
                      setCameraErrorHint('');
                    }}
                    className="w-full h-full object-cover"
                    style={{ transform: 'scaleX(-1)' }}
                  />
                  {/* Real-time yuz pozitsiyasi + identity overlay */}
                  {!cameraErrorHint && cameraPreviewOk && (
                    <div className="absolute bottom-0 left-0 right-0 flex items-stretch">
                      {/* Yuz pozitsiyasi (chap) */}
                      {!isWaiting && (
                        <div className={`flex-1 flex items-center gap-1.5 px-2 py-1.5 ${fsCfg.bg} ${fsCfg.text} transition-all duration-200`}>
                          <span className="text-sm font-bold leading-none">{fsCfg.icon}</span>
                          <span className="text-[10px] font-semibold leading-snug truncate">{fsCfg.label}</span>
                        </div>
                      )}
                      {/* Identity check holati (o'ng) */}
                      {identityStatus !== 'idle' && (
                        <div className={`flex items-center gap-1 px-2 py-1.5 text-[10px] font-bold transition-all duration-200 shrink-0 ${
                          identityStatus === 'checking' ? 'bg-blue-600/90 text-white' :
                          identityStatus === 'ok'       ? 'bg-emerald-600/90 text-white' :
                                                          'bg-red-600/90 text-white'
                        }`}>
                          {identityStatus === 'checking' && (
                            <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
                              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="40 20" />
                            </svg>
                          )}
                          {identityStatus === 'ok'       && <span>✓</span>}
                          {identityStatus === 'fail'     && <span>✗</span>}
                          <span>
                            {identityStatus === 'checking' ? 'ID...' :
                             identityStatus === 'ok'       ? 'ID OK' : 'ID ✗'}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                  {(cameraErrorHint || !cameraPreviewOk) && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-3 text-center bg-white/75 text-[11px] sm:text-xs text-gray-800">
                      {cameraErrorHint ? (
                        <>
                          <span className="font-semibold text-red-700 leading-snug">{cameraErrorHint}</span>
                          <AdminBtn
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setCameraErrorHint('');
                              setCameraPreviewOk(false);
                              setProctorRetryNonce((n) => n + 1);
                            }}
                          >
                            {t.examCameraReload}
                          </AdminBtn>
                        </>
                      ) : (
                        <span className="font-medium text-gray-600">{t.examCameraLoadingPreview}</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })()}

        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">{t.examPanelQuestions}</span>
          </div>
          <div className="p-4">
            <div className="grid grid-cols-5 gap-2">
              {exam.questions.map((q: any, i: number) => {
                const isAnswered = !!answers[q.id];
                const isFlagged = flaggedQuestions.includes(q.id);
                const isCurrent = i === qIndex;
                return (
                  <button
                    type="button"
                    key={q.id}
                    onClick={() => setQIndex(i)}
                    className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-medium transition-all ${
                      isCurrent ? 'ring-2 ring-offset-2 ring-indigo-500' : ''
                    } ${
                      isFlagged ? 'bg-yellow-100 text-yellow-700 border-2 border-yellow-400' :
                      isAnswered ? 'bg-indigo-500 text-white shadow-md shadow-indigo-500/20' :
                      'bg-white text-gray-600 border border-gray-200 hover:bg-white'
                    }`}
                  >
                    {i + 1}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">{t.examPanelWarnings}</span>
            <div className="flex items-center gap-1.5">
              {[1, 2, 3].map(num => (
                <div
                  key={num}
                  className={`w-3 h-3 rounded-full transition-colors ${
                    strikeLevel >= num ? 'bg-red-500 shadow-sm shadow-red-500/50' : 'bg-gray-200'
                  }`}
                />
              ))}
            </div>
          </div>
        </div>
      </motion.div>
      <Calculator />
    </div>
  );
}
