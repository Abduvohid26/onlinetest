import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { AdminBtn, AdminAlert } from './admin/ui';
import { useServerProctoring } from '../lib/useServerProctoring';
import { useRealtimeProctoring } from '../lib/useRealtimeProctoring';
import type { FaceStatusLive, LiveSignalType } from '../lib/realtimeProctor';
import {
  ALL_LIVE_SIGNAL_VIOLATIONS,
  LIVE_SIGNAL_CONFIRM_MS,
  LIVE_SIGNAL_ESCALATE_MS,
  TALK_SIGNAL_ESCALATE_MS,
  liveSignalViolationType,
} from '../lib/realtimeProctor';
import { SmallWarningLedger, SMALL_WARNINGS_BEFORE_FORMAL } from '../lib/smallWarningLedger';
import { SileroVad } from '../lib/sileroVad';
import { analyzeVoiceFrame, AmbientNoiseTracker, VoiceActivityTracker } from '../lib/voiceActivity';
import { ContinuousSignalTracker } from '../lib/continuousSignal';
import { ViolationGate } from '../lib/violationGate';
import { motion, AnimatePresence } from 'motion/react';
import { Calculator } from '../components/Calculator';
import { createRealtimeSocket, buildRealtimeUrl, type RealtimeSocket } from '../lib/realtimeSocket';
import { translations, Language, banReasonLabel } from '../i18n';
import { readJsonSafe } from '../lib/http';
import { apiUrl } from '../lib/apiUrl';
import { examAuthHeaders, setDeviceSessionToken } from '../lib/deviceFingerprint';
import { buildGuardedExamHeaders, syncVacFromResponse } from '../lib/examRequestGuard';
import type { ExamResultPayload } from '../components/ExamResultSummary';
import {
  openPreferredProctorStream,
  VIRTUAL_CAMERA_BLOCKED_MESSAGE,
} from '../lib/preferredCameraStream';
import { compressVideoFrameToJpeg } from '../lib/compressToJpeg';
import { cleanQuestionPrompt, normalizeQuestionOptions, optionLetter } from '../lib/examQuestionUtils';

// Savol panjarasi izohi (uz/ru/en) — katta i18n fayliga tegmasdan.
const EXAM_L: Record<Language, { answered: string; flagged: string; empty: string; faceOk: string; faceWaiting: string; faceNoFace: string; faceMulti: string; faceTooFar: string; faceTooClose: string; liveTalking: string; liveHeadAway: string; liveTooFar: string; liveTooClose: string; liveOffCenter: string; liveMovement: string; liveAmbientNoise: string; liveHand: string; liveNoFace: string; liveMultiFace: string; liveScreenshot: string; liveClipboard: string; liveDevtools: string; liveTabSwitch: string }> = {
  uz: {
    answered: 'Javob berilgan',
    flagged: 'Belgilangan',
    empty: 'Bo‘sh',
    faceOk: 'Yuz aniq',
    faceWaiting: 'Kamera tayyor...',
    faceNoFace: "Yuz ko'rinmayapti",
    faceMulti: 'Bir nechta yuz!',
    faceTooFar: "Yaqinroq o'ting",
    faceTooClose: "Uzoqroq toring",
    liveTalking: "Gapirish aniqlandi — jim bo'ling",
    liveHeadAway: "Kameraga qarang",
    liveTooFar: "Kameradan uzoqsiz",
    liveTooClose: "Kameraga yaqinsiz",
    liveOffCenter: "Kadr markaziga o'ting",
    liveMovement: "Haddan tashqari qimirlash — tinch o'tiring",
    liveAmbientNoise: "Tashqi shovqin bor — jimlikni saqlang",
    liveHand: "Qo'l ko'tarilgan — qo'llaringizni stolda ushlang",
    liveNoFace: "Yuzingiz ko'rinmayapti — kameraga qarang",
    liveMultiFace: "Kadrda bir nechta shaxs — yolg'iz qoling",
    liveScreenshot: "Ekran surati urinishi — to'xtating",
    liveClipboard: "Nusxa ko'chirish urinishi — to'xtating",
    liveDevtools: "Developer tools urinishi — to'xtating",
    liveTabSwitch: "Boshqa oynaga o'tildi — imtihonga qayting",
  },
  ru: {
    answered: 'Отвечено',
    flagged: 'Отмечено',
    empty: 'Пусто',
    faceOk: 'Лицо видно',
    faceWaiting: 'Камера...',
    faceNoFace: 'Лицо не видно',
    faceMulti: 'Несколько лиц!',
    faceTooFar: 'Ближе к камере',
    faceTooClose: 'Дальше от камеры',
    liveTalking: 'Обнаружен разговор — соблюдайте тишину',
    liveHeadAway: 'Смотрите в камеру',
    liveTooFar: 'Вы далеко от камеры',
    liveTooClose: 'Вы слишком близко к камере',
    liveOffCenter: 'Встаньте по центру кадра',
    liveMovement: 'Слишком много движений — сидите спокойно',
    liveAmbientNoise: 'Посторонний шум — соблюдайте тишину',
    liveHand: 'Рука поднята — держите руки на столе',
    liveNoFace: 'Лицо не видно — смотрите в камеру',
    liveMultiFace: 'В кадре несколько лиц — будьте одни',
    liveScreenshot: 'Попытка снимка экрана — прекратите',
    liveClipboard: 'Попытка копирования — прекратите',
    liveDevtools: 'Попытка открыть Developer tools — прекратите',
    liveTabSwitch: 'Переход в другое окно — вернитесь к экзамену',
  },
  en: {
    answered: 'Answered',
    flagged: 'Flagged',
    empty: 'Empty',
    faceOk: 'Face OK',
    faceWaiting: 'Camera...',
    faceNoFace: 'No face',
    faceMulti: 'Multiple faces!',
    faceTooFar: 'Move closer',
    faceTooClose: 'Move back',
    liveTalking: 'Talking detected — please stay silent',
    liveHeadAway: 'Look at the camera',
    liveTooFar: 'You are too far from the camera',
    liveTooClose: 'You are too close to the camera',
    liveOffCenter: 'Move to the center of the frame',
    liveMovement: 'Excessive movement — please stay still',
    liveAmbientNoise: 'Background noise detected — please stay quiet',
    liveHand: 'Hand raised — keep your hands on the desk',
    liveNoFace: 'Face not visible — look at the camera',
    liveMultiFace: 'Multiple people in frame — stay alone',
    liveScreenshot: 'Screenshot attempt — please stop',
    liveClipboard: 'Copy attempt — please stop',
    liveDevtools: 'Developer tools attempt — please stop',
    liveTabSwitch: 'Switched to another window — return to the exam',
  },
};

// Identity check: har 3 soniyada (OpenCV SFace lokal, tez ~100ms; throttle 60/min)
const IDENTITY_CHECK_MS = 90_000;

/** Tab/oynadan shuncha vaqtdan ko'p ketilsa — RASMIY qoidabuzarlik (TAB_SWITCH_HARD).
 *  Qisqa tasodifiy fokus yo'qolishi (brauzer UI, OS bildirishnomasi) hisoblanmaydi.
 *  "Kichik ogohlantirish" bosqichi YO'Q — talaba boshqa tabda uni ko'ra olmaydi. */
const TAB_AWAY_VIOLATION_MS = 1200;

/** Kichik ogohlantirish modali yopilgach — o'sha signal shuncha vaqt qayta ochmaydi. */
const SMALL_WARN_GRACE_MS = 3000;
/** Talaba "Tushundim" bosmasa ham modal shuncha vaqtdan keyin o'zi yopiladi.
 *  Bu MAJBURIY xavfsizlik chegarasi: aks holda talaba modalni ochiq qoldirib,
 *  nazorat muzlab turganda bemalol ko'chirishi mumkin bo'lardi. */
const SMALL_WARN_AUTOCLOSE_MS = 6000;
/** Rasmiy ogohlantirish modali ham cheksiz ochiq qolmasin — 10s da avto-yopiladi.
 *  Modal ochiqligida nazorat muzlaydi (warningModalShowingRef), shu sabab talaba
 *  uni ochiq qoldirib ko'chira olmasligi uchun majburiy chegara. */
const FORMAL_WARN_AUTOCLOSE_MS = 10000;

/**
 * Audio "gapirish" uchun kichik-ogohlantirish hisobi kaliti. Rasmiy tur talabaning
 * o'z og'zi qimirlayotganiga qarab o'zgaradi (MOUTH_MOVEMENT_TALKING / WHISPER...),
 * lekin HISOB bitta bo'lishi kerak — shu sabab kalit doim shu.
 */
const SPEECH_LEDGER_KEY = 'WHISPER_OR_CONVERSATION_SUSPECTED';

interface ExamRoomProps {
  exam: any;
  studentExamId: number;
  token: string;
  user: any;
  lang: Language;
  onFinish: (submitPayload?: ExamResultPayload | null) => void;
  onRetakeRestart?: () => void;
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

/** Print Screen / skrinshot tugmalari (brauzer va OS farqlari). */
function isPrintScreenKeyboardEvent(e: KeyboardEvent): boolean {
  const code = (e.code || '').toLowerCase();
  const key = (e.key || '').toLowerCase();
  if (code === 'printscreen' || key === 'printscreen' || key === 'snapshot') return true;
  // Windows: Win+Shift+S (Snipping Tool) — Chrome ba'zan metaKey sifatida beradi
  if (e.shiftKey && (e.metaKey || e.ctrlKey) && key === 's') return true;
  // macOS: Cmd+Shift+3/4/5
  if (e.metaKey && e.shiftKey && ['3', '4', '5'].includes(key)) return true;
  return false;
}

function reportPrintScreenViolation(log: (type: string) => void): void {
  void log('PRINT_SCREEN');
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

interface WarningHistoryItem {
  number: number;
  reason: string;
}

function WarningStepRow({
  warningCount,
  maxWarnings,
  banReached,
  isFinalPending,
  t,
}: {
  warningCount: number;
  maxWarnings: number;
  banReached: boolean;
  isFinalPending?: boolean;
  t: (typeof translations)['uz'];
}) {
  const steps = Array.from({ length: Math.max(1, maxWarnings) }, (_, i) => i + 1);
  return (
    <div className="flex flex-col items-center gap-2">
      <p className="text-[10px] sm:text-xs text-gray-500 uppercase tracking-wide font-medium">
        {t.violationProgressTitle}
      </p>
      <div className="flex justify-center items-center gap-1.5 sm:gap-2">
        {steps.map((n) => {
          const done = warningCount >= n;
          return (
            <div
              key={n}
              className={`w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center text-xs sm:text-sm font-bold border-2 transition-all ${
                done
                  ? banReached
                    ? 'bg-red-600 text-white border-red-700'
                    : 'bg-orange-100 text-orange-700 border-orange-400'
                  : 'bg-gray-100 text-gray-400 border-gray-200'
              }`}
            >
              {done ? (banReached ? '✓' : '!') : n}
            </div>
          );
        })}
        <div
          className={`min-w-[2.75rem] h-9 sm:h-10 px-2 rounded-full flex items-center justify-center text-[10px] sm:text-xs font-extrabold border-2 transition-all ${
            banReached
              ? 'bg-red-700 text-white border-red-800 shadow-md'
              : isFinalPending
                ? 'bg-red-600 text-white border-red-700 shadow-md'
                : 'bg-gray-50 text-gray-400 border-dashed border-gray-300'
          }`}
        >
          {t.violationStepBan}
        </div>
      </div>
    </div>
  );
}

/** Shu urinishdagi barcha qoidabuzarliklar ro'yxati — ogohlantirish/retake/ban modallarida bir xil ko'rinishda. */
function ViolationHistoryList({
  history,
  label,
}: {
  history: WarningHistoryItem[];
  label: string;
}) {
  if (history.length === 0) return null;
  return (
    <div className="mb-4 text-left">
      <p className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold mb-2">{label}</p>
      <ul className="space-y-1.5 text-[13px] text-gray-700 max-h-40 overflow-y-auto pr-1">
        {history.map((w) => (
          <li key={w.number} className="flex gap-2">
            <span className="shrink-0 font-bold text-orange-700">{w.number}.</span>
            <span className="break-words">{w.reason}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ExamRoom({ exam: initialExam, studentExamId: initialStudentExamId, token, user, lang, onFinish, onRetakeRestart }: ExamRoomProps) {
  const t = translations[lang];
  const [maxOfficialWarnings, setMaxOfficialWarnings] = useState(3);
  const [exam, setExam] = useState(initialExam);
  const [studentExamId, setStudentExamId] = useState(initialStudentExamId);
  const examQuestions = React.useMemo(
    () => (Array.isArray(exam.questions) ? exam.questions : []),
    [exam.questions],
  );
  const sessionStarted = Boolean(exam.startedAt && exam.sessionKey);
  const sessionStartedRef = useRef(sessionStarted);
  const [startingSession, setStartingSession] = useState(false);
  const [startError, setStartError] = useState('');
  useEffect(() => {
    sessionStartedRef.current = sessionStarted;
  }, [sessionStarted]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [flaggedQuestions, setFlaggedQuestions] = useState<number[]>([]);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  /** Internet bor, lekin Socket.io (proktor/realtime) ulanmagan yoki uzilgan. */
  const [realtimeSyncOffline, setRealtimeSyncOffline] = useState(false);
  const [realtimeBannerDismissed, setRealtimeBannerDismissed] = useState(false);
  const [banned, setBanned] = useState(false);
  const [timeLeft, setTimeLeft] = useState(() =>
    initialExam.startedAt && initialExam.sessionKey
      ? initialSecondsLeft(initialExam)
      : initialExam.duration_minutes * 60,
  );
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
  const [myAppeals, setMyAppeals] = useState<Array<{
    id: number;
    exam_id?: number;
    status: string;
    reason: string;
    created_at?: string | null;
    review_note?: string | null;
  }>>([]);
  /** Admin ban yechganda — "Davom etish" tugmasi chiqadi (WebSocket yoki polling). */
  const [unblockReady, setUnblockReady] = useState(false);
  /** Qoidabuzarlik limiti — avtomatik qayta topshirish (ban emas). */
  const [examRetakeNotice, setExamRetakeNotice] = useState<{
    remaining: number;
    used: number;
    reason: string;
    identityRetake?: boolean;
  } | null>(null);
  /** BAN paytida serverdagi jami violation yozuvlari (3 ta "!" o'rniga) */
  const [banViolationsCount, setBanViolationsCount] = useState<number | null>(null);
  const [banLastReason, setBanLastReason] = useState<string | null>(null);
  const [banReasonCode, setBanReasonCode] = useState<string | null>(null);
  const [warningHistory, setWarningHistory] = useState<WarningHistoryItem[]>([]);
  // Ogohlantirish modal
  const [violationWarning, setViolationWarning] = useState<ViolationWarning | null>(null);
  // Modal ochiqligida yangi violationlar serverga yuborilmasin
  const warningModalShowingRef = useRef(false);
  // Modal yopilgandan keyingi qisqa "nafas olish" oynasi — davom etayotgan real muammo
  // (masalan xonadagi shovqin, kamera burchagi) talaba modalni yopgan zahoti yana
  // darhol yangi ogohlantirish/strike bermasin, tuzatishga vaqt bersin.
  const postWarningGraceUntilRef = useRef(0);
  /** Kamera oqimi video elementga ulangach +1 (async setup va ref vaqti sinxroni). */
  const [proctorStreamRevision, setProctorStreamRevision] = useState(0);
  const [faceStatus, setFaceStatus] = useState<FaceStatusLive>('WAITING');
  const faceStatusRef = useRef<FaceStatusLive>('WAITING');
  /** Kamera panelida ko'rsatiladigan kichik ogohlantirish yorlig'i — signal faol bo'lgan
   *  davrda ko'rinib turadi, signal to'xtasa yashiriladi. 5s uzluksiz davom etsa mavjud
   *  logViolation oqimi rasmiy ogohlantirish modalini ochadi. */
  const [liveSignalLabel, setLiveSignalLabel] = useState<string | null>(null);
  /** Event/tab-manba qoidabuzarliklari (print-screen, clipboard, devtools, tab) uchun
   *  kichik yorliq — video/audio dan alohida qatorda. */
  const [eventLiveLabel, setEventLiveLabel] = useState<string | null>(null);

  // --- Kichik ogohlantirish MODALI ---
  // Chip (jonli holat) o'z holicha qoladi; ustiga talaba tasdiqlashi uchun kichik
  // modal chiqadi. Modal OCHIQ turganda nazorat "muzlaydi": o'sha vaqtda qilingan
  // qoidabuzarliklar hisoblanmaydi (strike/sanoq/rasmiy — hech biri). Talaba
  // "Tushundim" bossa yoki SMALL_WARN_AUTOCLOSE_MS o'tsa — davom etadi.
  const [smallWarn, setSmallWarn] = useState<{ text: string } | null>(null);
  /** Nazorat muzlaganmi (modal ochiqmi) — loop/callbacklar bir zumda o'qishi uchun ref. */
  const smallWarnOpenRef = useRef(false);
  /** Oxirgi ko'rsatilgan signal kaliti — o'sha signal grace ichida qayta ochmasin. */
  const smallWarnKeyRef = useRef<string | null>(null);
  const smallWarnGraceRef = useRef(0);
  const smallWarnAutoCloseRef = useRef<number | null>(null);

  const dismissSmallWarn = useCallback(() => {
    if (smallWarnAutoCloseRef.current !== null) {
      clearTimeout(smallWarnAutoCloseRef.current);
      smallWarnAutoCloseRef.current = null;
    }
    smallWarnOpenRef.current = false;
    smallWarnGraceRef.current = Date.now() + SMALL_WARN_GRACE_MS;
    // Muzlatilgan vaqtda to'plangan davomiylik dismissdan keyin darrov rasmiyga
    // aylanmasligi uchun audio trackerlarni yangidan boshlaymiz (video engine va
    // event gate grace-oynasi bilan o'zi tiklanadi).
    speechContinuousRef.current?.reset();
    ambientContinuousRef.current?.reset();
    micDownContinuousRef.current?.reset();
    setSmallWarn(null);
  }, []);

  /** Kichik ogohlantirish modalini ochadi (bitta modal + grace bilan spam oldini oladi). */
  const showSmallWarn = useCallback(
    (key: string, text: string) => {
      if (smallWarnOpenRef.current) return; // bitta modal — biri ochiq bo'lsa yangisi kutadi
      if (key === smallWarnKeyRef.current && Date.now() < smallWarnGraceRef.current) return;
      smallWarnKeyRef.current = key;
      smallWarnOpenRef.current = true;
      setSmallWarn({ text });
      // Suiiste'molga qarshi: talaba bosmasa ham o'zi yopiladi (nazorat davom etsin).
      smallWarnAutoCloseRef.current = window.setTimeout(dismissSmallWarn, SMALL_WARN_AUTOCLOSE_MS);
    },
    [dismissSmallWarn],
  );
  /** Loop/callbacklar eng yangi funksiyani ishlatishi uchun ref. */
  const showSmallWarnRef = useRef(showSmallWarn);
  showSmallWarnRef.current = showSmallWarn;

  // Rasmiy ogohlantirish yoki ban chiqsa — kichik modalni yopamiz (ular ustunroq
  // va o'zi bloklaydi; kichik modal ostida qolib ketmasin, muzlash ham tugasin).
  useEffect(() => {
    if ((violationWarning || banned) && smallWarnOpenRef.current) dismissSmallWarn();
  }, [violationWarning, banned, dismissSmallWarn]);
  // Unmount'da avto-yopilish taymerini tozalash.
  useEffect(() => () => {
    if (smallWarnAutoCloseRef.current !== null) clearTimeout(smallWarnAutoCloseRef.current);
  }, []);
  /** Barcha event/tab-manba qoidabuzarliklarini yagona 1.5s→4s qonuni bilan boshqaradi. */
  const eventGateRef = useRef<ViolationGate | null>(null);
  const [identityStatus, setIdentityStatus] = useState<'idle' | 'checking' | 'ok' | 'fail'>('idle');
  const identityStatusTimerRef = useRef<number | null>(null);
  const [proctorRetryNonce, setProctorRetryNonce] = useState(0);
  const [cameraPreviewOk, setCameraPreviewOk] = useState(false);
  const [cameraErrorHint, setCameraErrorHint] = useState('');
  const enableSizeHeuristicDevtools =
    String(import.meta.env.VITE_DEVTOOLS_SIZE_HEURISTIC || '').toLowerCase().trim() === 'true';
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

  /**
   * Barcha VAC-imzoli imtihon so'rovlari SHU navbat orqali serializatsiya qilinadi.
   * Server bitta monoton `session_request_seq`ni talab qiladi (prod'da VAC_SEQ_GUARD
   * default yoqilgan) — parallel timerlar (identity 3s, proctor 20s, autosave, clock,
   * submit) bir vaqtda so'rov yuborsa, ular bitta seq bilan to'qnashib 403 VAC_SEQ_RACE
   * oladi. Promise-zanjir mutex har bir guarded so'rovni ketma-ket (seq tartibida)
   * o'tkazadi: header qurish → fetch → javob seq/challenge sinxronlash — atomik.
   * Har so'rov qisqa; poll'lar orasidagi kutishlar navbatdan tashqarida, HOL blok yo'q.
   * AbortController timeout osilib qolgan so'rov butun imtihonni bloklamasligi uchun.
   */
  const vacChainRef = useRef<Promise<unknown>>(Promise.resolve());
  const guardedFetch = useCallback(
    (method: string, path: string, init?: RequestInit): Promise<Response> => {
      const run = async (): Promise<Response> => {
        const ac = new AbortController();
        const timeoutMs = method.toUpperCase() === 'POST' ? 30_000 : 20_000;
        const timer = window.setTimeout(() => ac.abort(), timeoutMs);
        try {
          const headers = {
            ...((init?.headers as Record<string, string> | undefined) || {}),
            ...(await nextGuardHeaders(method, path)),
          };
          const res = await fetch(apiUrl(path), { ...init, method, headers, signal: ac.signal });
          syncVacFromResponse(res.headers, vacStateRef.current);
          return res;
        } finally {
          window.clearTimeout(timer);
        }
      };
      const p = vacChainRef.current.then(run, run);
      // Zanjir xato bo'lsa ham uzilmasin (keyingi so'rovlar davom etsin).
      vacChainRef.current = p.then(
        () => undefined,
        () => undefined,
      );
      return p;
    },
    [nextGuardHeaders],
  );

  useEffect(() => {
    let cancelled = false;
    fetch(apiUrl('/api/student/proctor-config'), { headers: examAuthHeaders(token) })
      .then(async (res) => {
        const data = await readJsonSafe<{ max_warnings_before_ban?: number }>(res);
        if (!cancelled && res.ok && typeof data?.max_warnings_before_ban === 'number') {
          setMaxOfficialWarnings(Math.max(1, data.max_warnings_before_ban));
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [token]);

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
    if (!sessionStarted) return;
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
        const localAns = sanitizeExamAnswers(examQuestions, parseAnswersJson(localRaw));
        const srv = sanitizeExamAnswers(
          examQuestions,
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
          setAnswers(sanitizeExamAnswers(examQuestions, parseAnswersJson(saved)));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [exam.id, token, nextGuardHeaders, examQuestions, sessionStarted]);

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
  /** Talaba tabdan/oynadan ketgan payt (visibilitychange yoki blur). Qaytganda
   *  (visible/focus) qancha vaqt ketgani o'lchanadi — TAB_SWITCH_HARD uchun. */
  const awayStartedAtRef = useRef<number | null>(null);
  /** Modal/ogohlantirish fullscreen'dan chiqarishi — buni qoidabuzarlik deb hisoblamaymiz */
  const fullscreenSuppressRef = useRef(false);
  /** Foydalanuvchi ESC bilan ataylab chiqdi */
  const userEscFullscreenExitRef = useRef(false);
  const needsFullscreenRef = useRef(false);

  // Majburiy fullscreen (kiosk): faqat ESC bilan chiqilganda gate ko'rsatiladi.
  const [needsFullscreen, setNeedsFullscreen] = useState(false);
  const fullscreenSupportedRef = useRef(
    typeof document !== 'undefined' && !!document.documentElement.requestFullscreen,
  );

  const requestExamFullscreen = useCallback(() => {
    const el = document.documentElement;
    if (document.fullscreenElement || !el.requestFullscreen) return;
    fullscreenRequestedRef.current = true;
    fullscreenSuppressRef.current = true;
    blurIgnoreUntilRef.current = Date.now() + 3000;
    el.requestFullscreen().then(
      () => {
        fullscreenRequestedRef.current = false;
        fullscreenSuppressRef.current = false;
        userEscFullscreenExitRef.current = false;
        needsFullscreenRef.current = false;
        setNeedsFullscreen(false);
      },
      () => {
        fullscreenRequestedRef.current = false;
        fullscreenSuppressRef.current = false;
      },
    );
  }, []);

  useEffect(() => {
    if (!fullscreenSupportedRef.current) return;

    const onFullscreenChange = () => {
      if (document.fullscreenElement) {
        fullscreenEnteredRef.current = true;
        fullscreenRequestedRef.current = false;
        userEscFullscreenExitRef.current = false;
        fullscreenSuppressRef.current = false;
        needsFullscreenRef.current = false;
        setNeedsFullscreen(false);
        return;
      }

      if (!fullscreenEnteredRef.current || bannedRef.current) return;

      if (fullscreenSuppressRef.current || warningModalShowingRef.current) {
        return;
      }

      if (userEscFullscreenExitRef.current && sessionStartedRef.current) {
        userEscFullscreenExitRef.current = false;
        needsFullscreenRef.current = true;
        setNeedsFullscreen(true);
        void logViolationRef.current('FULLSCREEN_EXIT_HARD');
        return;
      }

      // Boshqa sabab (brauzer UI) — gate ko'rsatilmaydi; keyingi klikda qayta fullscreen.
      needsFullscreenRef.current = false;
      setNeedsFullscreen(false);
    };

    onFullscreenChange();
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

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

    // --- Tab almashtirish / alt-tab (boshqa dastur) — HODISA asosida aniqlash ---
    // MUHIM: brauzer fon tabda setInterval/setTimeout'ni muzlatadi, shu sabab faqat
    // polling'ga tayanib bo'lmaydi (talaba boshqa tabga o'tib AI ishlatsa sezilmasdi).
    // Shuning uchun: ketgan vaqtni `visibilitychange`/`blur` da yozamiz, QAYTGANDA
    // (`visible`/`focus`) qancha vaqt ketganini o'lchaymiz. Hodisalar taymer muzlaganda
    // ham ishonchli ishlaydi. Qaytishda darhol rasmiy TAB_SWITCH_HARD yoziladi —
    // "kichik ogohlantirish" bermaymiz, chunki talaba boshqa tabda uni ko'rmaydi.
    const markAwayStart = () => {
      if (bannedRef.current || !sessionStartedRef.current) return;
      if (Date.now() < blurIgnoreUntilRef.current) return; // fullscreen so'rovi paytida emas
      if (awayStartedAtRef.current == null) awayStartedAtRef.current = Date.now();
    };

    const markAwayEnd = () => {
      const startedAt = awayStartedAtRef.current;
      awayStartedAtRef.current = null;
      if (startedAt == null) return;
      if (bannedRef.current || !sessionStartedRef.current) return;
      if (Date.now() - startedAt >= TAB_AWAY_VIOLATION_MS) {
        void logViolationRef.current('TAB_SWITCH_HARD');
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') markAwayStart();
      else markAwayEnd();
    };
    const onWindowBlur = () => markAwayStart();
    const onWindowFocus = () => markAwayEnd();

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('blur', onWindowBlur);
    window.addEventListener('focus', onWindowFocus);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('blur', onWindowBlur);
      window.removeEventListener('focus', onWindowFocus);
    };
  }, []);

  const [qIndex, setQIndex] = useState(0);
  /** Oxirgi savoldagi "Yakunlash" tugmasi uchun tasdiqlash modali. */
  const [submitConfirm, setSubmitConfirm] = useState(false);
  const answeredCount = Object.keys(answers).length;
  const totalQuestions = examQuestions.length || Number(exam.bank_question_count) || 0;
  const progress = examQuestions.length > 0 ? (answeredCount / examQuestions.length) * 100 : 0;
  const currentQ = examQuestions[qIndex];
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

  /** Bir martalik hodisa (print-screen, clipboard, devtools) — endi darhol rasmiy
   *  YUBORMAYMIZ. Yagona darvozaga (eventGateRef) belgilaymiz: qonun bo'yicha 1.5s
   *  kichik yorliq, 4s uzluksiz takrorlansa rasmiy (tick loop hal qiladi). */
  const markGateEvent = useCallback((type: string) => {
    if (bannedRef.current || !sessionStartedRef.current) return;
    if (!eventGateRef.current) {
      eventGateRef.current = new ViolationGate(LIVE_SIGNAL_CONFIRM_MS, LIVE_SIGNAL_ESCALATE_MS);
    }
    eventGateRef.current.markEvent(type);
  }, []);
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
    faceStatusRef.current = faceStatus;
  }, [faceStatus]);

  // Ban ekranida WebSocket ishlamasa ham admin yechganda "Davom etish" chiqishi uchun polling.
  useEffect(() => {
    if (!banned || unblockReady) return;
    const pollUnblock = async () => {
      try {
        const res = await fetch(apiUrl('/api/student/exams'), {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const list = await readJsonSafe<Array<{ id: number; in_progress?: boolean }>>(res);
        const row = Array.isArray(list) ? list.find((e) => e.id === exam.id) : null;
        if (row?.in_progress) setUnblockReady(true);
      } catch {
        /* ignore */
      }
    };
    void pollUnblock();
    const id = window.setInterval(() => void pollUnblock(), 5000);
    return () => clearInterval(id);
  }, [banned, unblockReady, exam.id, token]);

  useEffect(() => {
    if (!banned || !token) return;
    let cancelled = false;
    fetch(apiUrl('/api/student/ban-appeals'), { headers: examAuthHeaders(token) })
      .then(async (res) => {
        const data = await readJsonSafe<typeof myAppeals>(res);
        if (!cancelled && Array.isArray(data)) {
          setMyAppeals(data.filter((a) => a.exam_id === exam.id));
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [banned, token, exam.id]);

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
  /** Silero VAD — odam ovozini maishiy shovqindan ajratuvchi asosiy detektor. */
  const sileroRef = useRef<SileroVad | null>(null);
  
  const identityCheckBusyRef = useRef(false);
  const logViolationRef = useRef<(type: string) => Promise<void>>(async () => {});
  /** DevTools/clipboard/varaq — bir "urinish"da yuboriladigan bir nechta signal; bittasini yuborish. */
  const focusBurstLockUntilRef = useRef(0);
  const FOCUS_BURST_TYPES = new Set([
    'DEVTOOLS_OPEN',
    'CLIPBOARD_ATTEMPT',
    'TAB_SWITCH_HARD',
    'TAB_SWITCH_SOFT',
    'FULLSCREEN_EXIT_HARD',
  ]);
  /**
   * "3 kichik ogohlantirish → 4-marta rasmiy" qonuni (README.md).
   * Kalit = rasmiy violation turi, shu sabab video/audio/event manbalari bitta
   * hisobga qo'shiladi va turlar aralashib ketmaydi.
   */
  const smallWarningLedgerRef = useRef(new SmallWarningLedger());

  /**
   * Kichik ogohlantirish epizodini qayd etadi. Limit to'lgan bo'lsa — darhol rasmiy.
   * @returns shu tur bo'yicha nechanchi kichik ogohlantirish (chip yorlig'ida ko'rsatiladi)
   */
  const noteSmallWarningRef = useRef((violationType: string): number => {
    const ledger = smallWarningLedgerRef.current;
    if (ledger.noteActive(violationType)) {
      ledger.formalIssued(violationType);
      void logViolationRef.current(violationType);
      return 0;
    }
    return ledger.count(violationType);
  });

  /**
   * Kichik yorliqqa hisobni qo'shadi: "Gapirmang · 2/3". Talaba nechta kichik
   * ogohlantirish qolganini ko'rib tursin — 3 tadan keyin rasmiy bo'ladi.
   */
  const withSmallCount = (msg: string, violationType: string): string => {
    const n = smallWarningLedgerRef.current.count(violationType);
    return n > 0 ? `${msg} · ${n}/${SMALL_WARNINGS_BEFORE_FORMAL}` : msg;
  };

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
    sileroRef.current?.dispose();
    sileroRef.current = null;
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

  const resumeAfterViolationAck = useCallback(() => {
    warningModalShowingRef.current = false;
    blurIgnoreUntilRef.current = Date.now() + 2000;
    postWarningGraceUntilRef.current = Date.now() + 8000;
    setWarningQueue([]);
    setViolationWarning(null);
    recoverCameraPreview();
    fullscreenSuppressRef.current = true;
    needsFullscreenRef.current = false;
    setNeedsFullscreen(false);
    void requestExamFullscreen();
  }, [recoverCameraPreview]);

  // Rasmiy ogohlantirish modali ochilsa — 10s da avto-yopiladi (talaba bosmasa ham).
  // Aks holda modal ochiq turganda nazorat muzlab, talaba bemalol ko'chirishi mumkin.
  useEffect(() => {
    if (!violationWarning || banned || hardBlocked) return;
    const id = window.setTimeout(() => resumeAfterViolationAck(), FORMAL_WARN_AUTOCLOSE_MS);
    return () => clearTimeout(id);
  }, [violationWarning, banned, hardBlocked, resumeAfterViolationAck]);

  const continueAfterUnblock = useCallback(() => {
    setUnblockReady(false);
    setBanned(false);
    setStrikeLevel(0);
    setViolationWarning(null);
    setBanViolationsCount(null);
    warningModalShowingRef.current = false;
    postWarningGraceUntilRef.current = Date.now() + 8000;
    fullscreenSuppressRef.current = true;
    needsFullscreenRef.current = false;
    setNeedsFullscreen(false);
    setProctorRetryNonce((n) => n + 1);
    recoverCameraPreview();
    void requestExamFullscreen();
  }, [recoverCameraPreview]);

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

    // Security: Disable right click, copy/paste, and keyboard shortcuts.
    // Qonun bo'yicha: darhol rasmiy YUBORMAYMIZ — darvozaga belgilaymiz (1.5s kichik,
    // 4s uzluksiz takror → rasmiy). Bir marta tasodifiy bosish jazolanmaydi.
    const handleContextMenu = (e: Event) => {
      e.preventDefault();
      markGateEvent('CLIPBOARD_ATTEMPT');
    };
    const handleCopyPaste = (e: Event) => {
      e.preventDefault();
      markGateEvent('CLIPBOARD_ATTEMPT');
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      const key = (e.key || '').toLowerCase();
      if (key === 'escape' && document.fullscreenElement && sessionStartedRef.current) {
        userEscFullscreenExitRef.current = true;
      }
      if (isPrintScreenKeyboardEvent(e)) {
        e.preventDefault();
        reportPrintScreenViolation((t) => markGateEvent(t));
        return;
      }
      const isClipboardCombo = (e.ctrlKey || e.metaKey) && ['c', 'v', 'x', 'a'].includes(key);
      const isDevtoolsCombo =
        key === 'f12' ||
        ((e.ctrlKey || e.metaKey) && e.shiftKey && ['i', 'j'].includes(key));
      if (isDevtoolsCombo) {
        e.preventDefault();
        if (document.hasFocus() && Boolean(document.fullscreenElement)) {
          markGateEvent('DEVTOOLS_OPEN');
        }
        return;
      }
      if (isClipboardCombo) {
        e.preventDefault();
        markGateEvent('CLIPBOARD_ATTEMPT');
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) {
        e.preventDefault();
      }
    };

    // Zoom bloklash: Ctrl+g'ildirak (trackpad/mishka) va Safari pinch gesture.
    // Ctrl+'+'/'-'/'0' allaqachon handleKeyDown ichida preventDefault qilinadi.
    const blockZoomWheel = (e: WheelEvent) => {
      if (e.ctrlKey) e.preventDefault();
    };
    const blockGesture = (e: Event) => e.preventDefault();

    const handleKeyUp = (e: KeyboardEvent) => {
      if (isPrintScreenKeyboardEvent(e)) {
        e.preventDefault();
        reportPrintScreenViolation((t) => markGateEvent(t));
      }
    };

    document.addEventListener('contextmenu', handleContextMenu);
    document.addEventListener('copy', handleCopyPaste);
    document.addEventListener('paste', handleCopyPaste);
    document.addEventListener('cut', handleCopyPaste);
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
    document.addEventListener('wheel', blockZoomWheel, { passive: false });
    document.addEventListener('gesturestart', blockGesture);
    document.addEventListener('gesturechange', blockGesture);

    // DevTools o'lcham-evristikasi: ochiq panel — DAVOMIY holat. Tez (500ms) poll qilib
    // darvozaga belgilaymiz; panel ochiq turgan har lahzada marklanadi → 4s uzluksiz
    // bo'lsa qonun bo'yicha rasmiyga o'tadi (bir zumlik o'lcham o'zgarishi jazolanmaydi).
    let devtoolsTick: number | null = null;
    if (enableSizeHeuristicDevtools) {
      let consecutiveHits = 0;
      devtoolsTick = window.setInterval(() => {
        if (bannedRef.current || !sessionStartedRef.current) return;
        if (!document.fullscreenElement || !document.hasFocus()) {
          consecutiveHits = 0;
          return;
        }
        const dw = Math.abs((window.outerWidth || 0) - (window.innerWidth || 0));
        const dh = Math.abs((window.outerHeight || 0) - (window.innerHeight || 0));
        const suspicious = dw > 320 && dh > 180;
        consecutiveHits = suspicious ? consecutiveHits + 1 : 0;
        if (consecutiveHits >= 2) markGateEvent('DEVTOOLS_OPEN');
      }, 500);
    }

    // Har bir klik/touch — fullscreen (ESC gate ochiq bo'lsa, faqat gate tugmasi ishlaydi).
    const ensureFullscreenOnGesture = () => {
      // Safety net: AudioContext "suspended" bo'lsa (brauzer avtoplay siyosati) —
      // har foydalanuvchi harakatida tiklaymiz. Aks holda mikrofon jimlik beradi va
      // OVOZ ANIQLANMAYDI (analyser 0 qaytaradi). Bu ovoz-aniqlash muammosining
      // eng ehtimoliy sababi edi.
      if (audioContextRef.current?.state === 'suspended') {
        audioContextRef.current.resume().catch(() => {});
      }
      if (bannedRef.current) return;
      if (needsFullscreenRef.current) return;
      if (document.fullscreenElement) return;
      requestExamFullscreen();
    };
    window.addEventListener('pointerdown', ensureFullscreenOnGesture, { capture: true });

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
                  setUnblockReady(true);
                  showWarningMsg(translations[langRef.current].unblockAllowedMsg || 'Admin imtihonni davom ettirishingizga ruxsat berdi!', 6000);
                } else {
                  showWarningMsg(translations[langRef.current].unblockDeniedMsg || 'Admin imtihonni tugatdi. Topshira olmaysiz.', 8000);
                }
              }
            } else if (msg.type === 'exam_retake' || msg.type === 'technical_retake') {
              const md = msg as any;
              if (String(md.student_id) === String(user.id)) {
                const remaining =
                  typeof md.retakes_remaining === 'number'
                    ? md.retakes_remaining
                    : typeof md.technical_retakes_remaining === 'number'
                      ? md.technical_retakes_remaining
                      : 0;
                const reason = String(md.reason || '').trim();
                const identityRetake = Boolean(md.identity_retake);
                if (remaining <= 0 && !identityRetake) {
                  setBanned(true);
                  setBanLastReason(reason);
                  setBanReasonCode('RETAKE_EXHAUSTED');
                  setUnblockReady(false);
                  releaseCameraAndMic();
                  return;
                }
                setBanned(false);
                setUnblockReady(false);
                if (reason) {
                  setWarningHistory((prev) => {
                    if (prev.some((w) => w.reason === reason && w.number === prev.length)) return prev;
                    return [...prev, { number: prev.length + 1, reason }];
                  });
                }
                setExamRetakeNotice({
                  remaining,
                  used: typeof md.retakes_used === 'number' ? md.retakes_used : 0,
                  reason,
                  identityRetake,
                });
                releaseCameraAndMic();
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
          const onMicLost = () => {
            if (!sessionStartedRef.current || bannedRef.current) return;
            void logViolationRef.current('CAMERA_MIC_ACCESS_FAILED');
          };
          for (const tr of stream.getAudioTracks()) {
            tr.addEventListener('ended', onMicLost);
            tr.addEventListener('mute', onMicLost);
          }

          // Silero VAD ni fon rejimida yuklaymiz — imtihon boshlanishini
          // KUTTIRMAYDI. Tayyor bo'lguncha eski DSP mantig'i ishlab turadi.
          sileroRef.current?.dispose();
          const vad = new SileroVad();
          sileroRef.current = vad;
          void vad.init(stream).then((ok) => {
            console.info('[silero-vad]', ok ? 'tayyor' : 'yo\'q — DSP zaxirasi');
          });
        } else {
          audioContextRef.current = null;
          analyserRef.current = null;
          sileroRef.current?.dispose();
          sileroRef.current = null;
        }

      } catch (err) {
        setCameraPreviewOk(false);
        if (err instanceof DOMException && err.message === VIRTUAL_CAMERA_BLOCKED_MESSAGE) {
          setCameraErrorHint(translations[langRef.current].virtualCameraBlocked);
          // Alohida mahalliy xabar YO'Q — bu haqiqiy qoidabuzarlik, logViolation
          // o'zi rasmiy ogohlantirish modalini (bir xil dizayn) ochadi.
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
      window.removeEventListener('pointerdown', ensureFullscreenOnGesture, true);
      document.removeEventListener('contextmenu', handleContextMenu);
      document.removeEventListener('copy', handleCopyPaste);
      document.removeEventListener('paste', handleCopyPaste);
      document.removeEventListener('cut', handleCopyPaste);
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
      document.removeEventListener('wheel', blockZoomWheel);
      document.removeEventListener('gesturestart', blockGesture);
      document.removeEventListener('gesturechange', blockGesture);
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
  }, [banned, exam.id, token, user.id, proctorRetryNonce, requestExamFullscreen]);

  // --- Real-time ovoz: faqat inson nutqi (spektr + RMS), ~200ms freym.
  // Qonun (README.md "Proctoring eskalatsiya qoidasi") bilan bir xil ikki bosqich:
  // 1.5s uzluksiz — kamera panelida kichik yorliq, 4s — rasmiy ogohlantirish.
  const voiceTrackerRef = useRef<VoiceActivityTracker | null>(null);
  const ambientTrackerRef = useRef<AmbientNoiseTracker | null>(null);
  const speechContinuousRef = useRef<ContinuousSignalTracker | null>(null);
  const ambientContinuousRef = useRef<ContinuousSignalTracker | null>(null);
  /** Video (og'iz harakati) hozir "gapiryapti" deb hisoblanadimi — ovoz eskalatsiyasida
   *  WHISPER_OR_CONVERSATION_SUSPECTED (boshqa odam) vs MOUTH_MOVEMENT_TALKING (o'zi)
   *  ni ajratish uchun. */
  const mouthActiveRef = useRef(false);
  /** Ovoz manbali kichik yorliq — kamera panelida video signalidan ALOHIDA qatorda
   *  ko'rsatiladi (shovqin va gapirish matni farqlanishi uchun). */
  const [audioLiveLabel, setAudioLiveLabel] = useState<string | null>(null);
  /** VAQTINCHA DEBUG: audio qiymatlarini ekranda ko'rsatish (ovoz-aniqlash muammosini
   *  aniqlash uchun; muammo hal bo'lgach olib tashlanadi). */
  const audioDbgTickRef = useRef(0);

  useEffect(() => {
    if (banned) return;
    const analyser = analyserRef.current;
    if (!analyser) return;
    if (!voiceTrackerRef.current) voiceTrackerRef.current = new VoiceActivityTracker();
    if (!ambientTrackerRef.current) ambientTrackerRef.current = new AmbientNoiseTracker();
    // Ovoz (gapirish): grace 700ms — so'zlar orasidagi qisqa pauzani ko'prik qiladi.
    if (!speechContinuousRef.current) speechContinuousRef.current = new ContinuousSignalTracker(700);
    // Shovqin: grace QISQA (300ms) — bir martalik "taq"lar orasidagi tanaffus ko'prik
    // qilinmasin, faqat HAQIQATAN uzluksiz shovqin (musiqa/TV) to'planib rasmiy bo'lsin.
    if (!ambientContinuousRef.current) ambientContinuousRef.current = new ContinuousSignalTracker(300);
    const id = window.setInterval(() => {
      if (bannedRef.current || !analyserRef.current) return;
      // Modal ochiq — nazorat muzlagan: audio hisobini butunlay to'xtatamiz.
      if (smallWarnOpenRef.current) return;
      const frame = analyzeVoiceFrame(analyserRef.current);
      const now = Date.now();

      // ODAM OVOZI: asosiy detektor — Silero VAD (neyron tarmoq). Real audioda
      // o'lchangan: 100% aniqlash, 0% soxta ijobiy; qo'lda yozilgan DSP esa jim
      // ovozda 7.5%, soxta ijobiyda 13.7% berardi (docs/VAD_BENCHMARK.md).
      // Model yuklanmasa — eski DSP zaxira sifatida ishlaydi (imtihon buzilmasin).
      const silero = sileroRef.current;
      const speechRaw = silero?.ready
        ? silero.isSpeaking()
        : voiceTrackerRef.current!.push(frame);

      // Shovqin (SUSPICIOUS_AUDIO) — baland, LEKIN nutq bo'lmagan tovush. Nutq
      // qarorini Silero beradi, shu sabab gapirish shovqin deb ikki marta
      // yozilmaydi.
      const ambientRaw = ambientTrackerRef.current!.push(frame, speechRaw);
      const ambientMs = ambientContinuousRef.current!.push(ambientRaw, now);
      // OVOZ DOIM aniqlanadi — yuz holatiga BOG'LANMAYDI. Ilgari isFaceVisibleForTalk
      // gate'i bor edi: MediaPipe yuzni WAITING/aniqlamagan paytda ovoz umuman
      // sezilmasdi. Talaba o'zi gapiryaptimi yoki kamerasiz kimdir — bu farq keyin
      // mouthActiveRef orqali (MOUTH_MOVEMENT_TALKING vs WHISPER) hal qilinadi.
      const speechMs = speechContinuousRef.current!.push(speechRaw, now);

      audioDbgTickRef.current += 1;
      const ctxState = audioContextRef.current?.state ?? 'yo\'q';
      // Diagnostika: har ~1s serverga yuboriladi (ekranda ko'rinmaydi) —
      // `docker compose logs app` orqali o'qiladi. Muammo hal bo'lgach olib tashlanadi.
      if (audioDbgTickRef.current % 5 === 0) {
        void fetch(apiUrl('/api/student/debug-audio'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...examAuthHeaders(tokenRef.current) },
          body: JSON.stringify({
            rms: Number(frame.rms.toFixed(4)),
            humanVoice: frame.humanVoice,
            speechRatio: Number(frame.speechRatio.toFixed(3)),
            harmonicity: Number(frame.harmonicity.toFixed(3)),
            zcr: Number(frame.zcr.toFixed(3)),
            lowFreqRatio: Number(frame.lowFreqRatio.toFixed(3)),
            crestFactor: Number(frame.crestFactor.toFixed(2)),
            sileroReady: Boolean(sileroRef.current?.ready),
            sileroProb: Number((sileroRef.current?.probability ?? 0).toFixed(3)),
            speechMs: Math.round(speechMs),
            ambientMs: Math.round(ambientMs),
            ctx: ctxState,
            faceStatus: faceStatusRef.current,
          }),
        }).catch(() => {});
      }

      // Gapirish (odam ovozi) — MAXSUS tez qoida: kichik ogohlantirish DARHOL
      // (aniqlanishi bilanoq), rasmiy 2s. Sabab: tashqaridan gapirib turgan odam
      // bir necha soniyada javobni aytib ulguradi — kutib bo'lmaydi. Chip faqat
      // vizual (backendga hech narsa ketmaydi), shu sabab darhol ko'rsatish xavfsiz;
      // `speechMs > 0` = kamida bitta freymda inson ovozi topildi (tracker grace
      // 700ms so'zlar orasidagi pauzada chipni o'chirib-yoqmaydi).
      // Shovqin (ambient) esa umumiy qonunda qoladi: 1.5s kichik, 4s rasmiy.
      // Ovoz shovqindan muhimroq, shu sabab chipda birinchi o'rinda turadi.
      // Kichik ogohlantirish epizodlari sanaladi ("3 kichik → 4-si rasmiy").
      const speechSmall = speechMs > 0;
      const ambientSmall = ambientMs >= LIVE_SIGNAL_CONFIRM_MS;
      if (speechSmall) noteSmallWarningRef.current(SPEECH_LEDGER_KEY);
      else smallWarningLedgerRef.current.noteCleared(SPEECH_LEDGER_KEY);
      if (ambientSmall) noteSmallWarningRef.current('SUSPICIOUS_AUDIO');
      else smallWarningLedgerRef.current.noteCleared('SUSPICIOUS_AUDIO');

      if (speechSmall) {
        const label = withSmallCount(EXAM_L[langRef.current].liveTalking, SPEECH_LEDGER_KEY);
        setAudioLiveLabel(label);
        showSmallWarnRef.current('a:speech', label);
      } else if (ambientSmall) {
        const label = withSmallCount(
          EXAM_L[langRef.current].liveAmbientNoise,
          'SUSPICIOUS_AUDIO',
        );
        setAudioLiveLabel(label);
        showSmallWarnRef.current('a:ambient', label);
      } else {
        setAudioLiveLabel(null);
      }

      if (ambientMs >= LIVE_SIGNAL_ESCALATE_MS) {
        ambientContinuousRef.current!.reset();
        smallWarningLedgerRef.current.formalIssued('SUSPICIOUS_AUDIO');
        void logViolationRef.current('SUSPICIOUS_AUDIO');
      }
      if (speechMs >= TALK_SIGNAL_ESCALATE_MS) {
        speechContinuousRef.current!.reset();
        smallWarningLedgerRef.current.formalIssued(SPEECH_LEDGER_KEY);
        // Talabaning o'z og'zi ham qimirlayotgan bo'lsa — o'zi gapiryapti; aks holda
        // atrofda/orqada boshqa odam gapirishi shubhasi.
        void logViolationRef.current(
          mouthActiveRef.current ? 'MOUTH_MOVEMENT_TALKING' : 'WHISPER_OR_CONVERSATION_SUSPECTED',
        );
      }
    }, 200);
    return () => clearInterval(id);
  }, [banned, analyserRef.current]);

  // Mikrofon o'chgan yoki tahlil yo'q — gapirish nazorati ishlamaydi. Davomiy holat
  // (mikrofon tuzatilmaguncha davom etadi) — qonun bo'yicha uzluksiz kuzatiladi,
  // har tekshiruvda emas, faqat eskalatsiya bosqichida (4s) va undan keyin resetdan
  // so'ng yana to'liq muddatdan keyin qayta yuboriladi (tinimsiz spam bo'lmasin).
  const micDownContinuousRef = useRef<ContinuousSignalTracker | null>(null);
  useEffect(() => {
    if (banned || !sessionStarted) return;
    const graceUntil = Date.now() + 12_000;
    if (!micDownContinuousRef.current) micDownContinuousRef.current = new ContinuousSignalTracker(1000);
    const id = window.setInterval(() => {
      if (bannedRef.current || !sessionStartedRef.current) return;
      if (Date.now() < graceUntil) return;
      const tracks = streamRef.current?.getAudioTracks() ?? [];
      const audioLive = tracks.some((t) => t.readyState === 'live' && t.enabled && !t.muted);
      const micDown = !analyserRef.current || !audioLive;
      const ms = micDownContinuousRef.current!.push(micDown);
      if (ms >= LIVE_SIGNAL_ESCALATE_MS) {
        micDownContinuousRef.current!.reset();
        smallWarningLedgerRef.current.formalIssued('CAMERA_MIC_ACCESS_FAILED');
        void logViolationRef.current('CAMERA_MIC_ACCESS_FAILED');
      } else if (ms >= LIVE_SIGNAL_CONFIRM_MS) {
        noteSmallWarningRef.current('CAMERA_MIC_ACCESS_FAILED');
      } else {
        smallWarningLedgerRef.current.noteCleared('CAMERA_MIC_ACCESS_FAILED');
      }
    }, 2000);
    return () => clearInterval(id);
  }, [banned, sessionStarted]);

  // --- Yagona darvoza tick loop (event/tab-manba qoidabuzarliklari) ---
  // Qonun (README.md): har bir tur uchun 1.5s uzluksiz → kamera panelida kichik yorliq,
  // 4s → rasmiy (logViolation), so'ng reset (tinimsiz takrorlanmasin).
  useEffect(() => {
    if (banned || !sessionStarted) return;
    if (!eventGateRef.current) {
      eventGateRef.current = new ViolationGate(LIVE_SIGNAL_CONFIRM_MS, LIVE_SIGNAL_ESCALATE_MS);
    }
    const gate = eventGateRef.current;
    // Faqat event-manba (markEvent orqali marklanadigan) turlar bu ro'yxatda.
    const EVENT_TYPES = ['PRINT_SCREEN', 'CLIPBOARD_ATTEMPT', 'DEVTOOLS_OPEN'];
    const LABEL: Record<string, keyof (typeof EXAM_L)['uz']> = {
      PRINT_SCREEN: 'liveScreenshot',
      CLIPBOARD_ATTEMPT: 'liveClipboard',
      DEVTOOLS_OPEN: 'liveDevtools',
      TAB_SWITCH_HARD: 'liveTabSwitch',
    };
    const id = window.setInterval(() => {
      if (bannedRef.current || !sessionStartedRef.current) return;
      // Modal ochiq — nazorat muzlagan: event/tab hisobini to'xtatamiz.
      if (smallWarnOpenRef.current) return;
      const now = Date.now();
      let best: { type: string; ms: number } | null = null;

      const consider = (type: string, activeState: boolean) => {
        const ms = gate.push(type, activeState, now);
        if (ms >= LIVE_SIGNAL_ESCALATE_MS) {
          gate.reset(type);
          smallWarningLedgerRef.current.formalIssued(type);
          void logViolationRef.current(type);
          return;
        }
        // Kichik ogohlantirish bosqichi — epizod sanaladi ("3 kichik → 4-si rasmiy").
        if (ms >= LIVE_SIGNAL_CONFIRM_MS) {
          noteSmallWarningRef.current(type);
          if (!best || ms > best.ms) best = { type, ms };
        } else {
          smallWarningLedgerRef.current.noteCleared(type);
        }
      };

      for (const type of EVENT_TYPES) consider(type, false);
      // Tab yashiringan — davomiy holat (poll). blurIgnoreUntil (fullscreen so'rovi) e'tiborsiz.
      const tabHidden =
        document.visibilityState === 'hidden' && now >= blurIgnoreUntilRef.current;
      consider('TAB_SWITCH_HARD', tabHidden);

      const bestType = best ? (best as { type: string }).type : null;
      if (bestType) {
        const label = withSmallCount(EXAM_L[langRef.current][LABEL[bestType]], bestType);
        setEventLiveLabel(label);
        showSmallWarnRef.current(`e:${bestType}`, label);
      } else {
        setEventLiveLabel(null);
      }
    }, 250);
    return () => clearInterval(id);
  }, [banned, sessionStarted]);

  const [identityTerminated, setIdentityTerminated] = useState(false);

  // --- Violation logging ---
  /**
   * Matn tarjima qilinmagan xom kodmi (`MOUTH_MOVEMENT_TALKING`, `NO_ACTIVE_SESSION`)?
   * Bunday matn talabaga ko'rsatilmaydi — u faqat ichki identifikator.
   */
  const isRawCode = (s: string) => /^[A-Z][A-Z0-9_]{3,}$/.test(s.trim());

  const logViolation = async (type: string) => {
    if (bannedRef.current) return;
    if (!sessionStartedRef.current) return;

    // Server: strict VAC da faqat IDENTITY_SUBSTITUTION darhol ban; qolganlari ogohlantirish ketma-ketligi.
    const INSTANT_BAN_TYPES = new Set(['IDENTITY_SUBSTITUTION']);

    // Kichik ogohlantirish modali ochiq — nazorat MUZLAGAN: talaba "Tushundim"
    // bosguncha (yoki avto-yopilishgacha) qilingan qoidabuzarliklar yutiladi
    // (strike/rasmiy hisoblanmaydi). Yagona istisno — yuz almashtirish (identity):
    // bu jiddiy xavfsizlik hodisasi, muzlatib bo'lmaydi.
    if (smallWarnOpenRef.current && !INSTANT_BAN_TYPES.has(type)) return;

    // Modal ochiqligida yangi violationlar (IDENTITY_SUBSTITUTION dan tashqari) bloklansn —
    // talaba ogohlantirishni o'qib javob bergandan keyin davom etsin.
    const BYPASS_MODAL_BLOCK = new Set(['IDENTITY_SUBSTITUTION', 'PRINT_SCREEN']);
    if (warningModalShowingRef.current && !BYPASS_MODAL_BLOCK.has(type)) return;

    // Modal yopilgandan keyingi qisqa grace oynasi — davom etayotgan sabab (masalan
    // xonadagi shovqin) darhol ketma-ket yana strike bermasin, tuzatishga vaqt bersin.
    if (Date.now() < postWarningGraceUntilRef.current && !INSTANT_BAN_TYPES.has(type)) return;

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
        // Ban/retake javob maydonlari (backend: student_violations, proctor_exam_retake).
        banReason?: string;
        technicalRetake?: boolean;
        examRetake?: boolean;
        identityRetake?: boolean;
        retakesRemaining?: number;
        retakesUsed?: number;
        technicalRetakesRemaining?: number;
        technicalRetakesUsed?: number;
      }>(res)) || {};

      if (!res.ok) {
        // Faqat O'QILADIGAN sabab ko'rsatiladi. Xom kod (MOUTH_MOVEMENT_TALKING,
        // NO_ACTIVE_SESSION...) talabaga hech narsa anglatmaydi — u holda jim
        // o'tkazamiz: kamera panelidagi kichik chip allaqachon signal bergan.
        const hint = String(data.violationReason || data.error || '').trim();
        if (hint && !isRawCode(hint)) showWarningMsg(hint, 5000);
        return;
      }

      // Ixtiyoriy startup grace (PROCTOR_STARTUP_GRACE_SECONDS) — strike hisoblanmaydi.
      if (data.startupGrace) {
        const detail = String(data.violationReason || '').trim();
        if (detail && !isRawCode(detail)) showWarningMsg(detail, 5000);
        return;
      }

      if (data.banned) {
        if (type === 'IDENTITY_SUBSTITUTION') setIdentityTerminated(true);
        setViolationWarning(null);
        setStrikeLevel(maxOfficialWarnings);
        const reasonText = data.violationReason || t.violationReasonFallback;
        setBanLastReason(reasonText);
        setBanReasonCode(typeof data.banReason === 'string' ? data.banReason : null);
        const warnNum =
          typeof data.warningNumber === 'number' && data.warningNumber > 0
            ? data.warningNumber
            : typeof data.officialWarnings === 'number' && data.officialWarnings > 0
              ? data.officialWarnings
              : maxOfficialWarnings;
        setWarningHistory((prev) => {
          if (prev.some((w) => w.number === warnNum)) return prev;
          return [...prev, { number: warnNum, reason: reasonText }].sort((a, b) => a.number - b.number);
        });
        if (typeof data.violationsCount === 'number') {
          setBanViolationsCount(data.violationsCount);
        } else {
          setBanViolationsCount(null);
        }
        setBanned(true);
        releaseCameraAndMic();
        return;
      }

      if (data.technicalRetake || data.examRetake) {
        setViolationWarning(null);
        const remaining =
          typeof data.retakesRemaining === 'number'
            ? data.retakesRemaining
            : typeof data.technicalRetakesRemaining === 'number'
              ? data.technicalRetakesRemaining
              : 0;
        const used =
          typeof data.retakesUsed === 'number'
            ? data.retakesUsed
            : typeof data.technicalRetakesUsed === 'number'
              ? data.technicalRetakesUsed
              : 0;
        const reasonText = String(data.violationReason || '').trim();
        const identityRetake = Boolean(data.identityRetake);
        if (remaining <= 0 && !identityRetake) {
          setBanLastReason(reasonText);
          setBanReasonCode(
            typeof data.banReason === 'string' ? data.banReason : 'RETAKE_EXHAUSTED',
          );
          if (typeof data.violationsCount === 'number') {
            setBanViolationsCount(data.violationsCount);
          }
          setBanned(true);
          releaseCameraAndMic();
          return;
        }
        if (reasonText) {
          setWarningHistory((prev) => {
            if (prev.some((w) => w.reason === reasonText && w.number === prev.length)) return prev;
            return [...prev, { number: prev.length + 1, reason: reasonText }];
          });
        }
        setExamRetakeNotice({
          remaining,
          used,
          reason: reasonText,
          identityRetake,
        });
        releaseCameraAndMic();
        return;
      }

      // Barcha boshqa qoidabuzarliklar — DOIM modal ko'rsatamiz (suppressed/merged bo'lsa ham).
      const official = typeof data.officialWarnings === 'number' ? data.officialWarnings : 0;
      const shownNumber =
        typeof data.warningNumber === 'number' && data.warningNumber > 0
          ? data.warningNumber
          : Math.max(1, official);
      const reasonText = data.violationReason || t.violationReasonFallback;
      setWarningHistory((prev) => {
        if (prev.some((w) => w.number === shownNumber)) return prev;
        return [...prev, { number: shownNumber, reason: reasonText }].sort((a, b) => a.number - b.number);
      });
      setStrikeLevel(official > 0 ? official : shownNumber);
      fullscreenSuppressRef.current = true;
      warningModalShowingRef.current = true;
      setViolationWarning({
        reason: reasonText,
        warningNumber: shownNumber,
        isFinalWarning: data.isFinalWarning === true,
      });
    } catch {
      // Tarmoq xatosi — talabaga xom violation kodini ko'rsatish foydasiz va
      // chalkash (u "kichik ogohlantirish" deb tushunadi). Jim o'tkazamiz:
      // signal kamera panelidagi chipda ko'rinib turibdi, rasmiy ogohlantirish
      // esa faqat server javobidan keyin chiqadi.
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
    onViolation: (type) => {
      // Uzluksiz eskalatsiya bo'yicha rasmiy berildi — shu tur hisobi nolga qaytadi.
      smallWarningLedgerRef.current.formalIssued(type);
      void logViolationRef.current(type);
    },
    onRecheckIdentity: () => triggerIdentityCheckRef.current(),
    onFaceStatus: setFaceStatus,
    onSmallWarningStage: (types) => {
      // Modal ochiq — nazorat muzlagan: bu kadrda hech narsa sanamaymiz.
      if (smallWarnOpenRef.current) return;
      // Har kadrda: hozir kichik-ogohlantirish bosqichidagi turlarni sanaymiz,
      // qolganlarini "epizod tugadi" deb yopamiz (keyingi safar yangi epizod).
      const active = new Set<string>(types.map(liveSignalViolationType));
      for (const key of ALL_LIVE_SIGNAL_VIOLATIONS) {
        if (active.has(key)) noteSmallWarningRef.current(key);
        else smallWarningLedgerRef.current.noteCleared(key);
      }
    },
    onLiveSignal: (type) => {
      // Ovoz eskalatsiyasi (audio effekt) uchun — video og'iz harakati hozir
      // faolmi (WHISPER vs MOUTH_MOVEMENT_TALKING ajratishda ishlatiladi).
      mouthActiveRef.current = type === 'TALKING';
      // Modal ochiq — nazorat muzlagan: chip va modalni yangilamaymiz.
      if (smallWarnOpenRef.current) return;
      if (!type) {
        setLiveSignalLabel(null);
        return;
      }
      const msg = {
        TALKING: EXAM_L[langRef.current].liveTalking,
        HEAD_AWAY: EXAM_L[langRef.current].liveHeadAway,
        TOO_FAR: EXAM_L[langRef.current].liveTooFar,
        TOO_CLOSE: EXAM_L[langRef.current].liveTooClose,
        OFF_CENTER: EXAM_L[langRef.current].liveOffCenter,
        MOVEMENT: EXAM_L[langRef.current].liveMovement,
        HAND: EXAM_L[langRef.current].liveHand,
        NO_FACE: EXAM_L[langRef.current].liveNoFace,
        MULTI_FACE: EXAM_L[langRef.current].liveMultiFace,
      }[type];
      // Kamera panelidagi kichik yorliq (chip) — jonli holat. Rasmiy ogohlantirish
      // ikki yo'l bilan keladi: (a) signal uzluksiz eskalatsiya muddatiga yetsa
      // (realtimeProctor.ts), (b) shu tur bo'yicha kichik ogohlantirishlar 3 tadan
      // oshsa (SmallWarningLedger).
      const label = withSmallCount(msg, liveSignalViolationType(type));
      setLiveSignalLabel(label);
      // Chip ustiga — talaba tasdiqlashi uchun kichik modal.
      showSmallWarnRef.current(`v:${type}`, label);
    },
  });

  // --- Periodic identity match (Gemini serverda) ---
  // 90 soniyada bir marta; faqat yuz aniqlanganida.
  const identityFailCountRef = useRef(0);
  /** Tarmoq xatosidan keyin bir martalik qayta urinish belgisi (cheksiz sikl bo'lmasin). */
  const retriedRef = useRef(false);
  // Real-time engine person-swap shubhasida darhol identity tekshiruvini ishga tushiradi.
  const triggerIdentityCheckRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (banned || !user.profile_image || !sessionStarted) return;

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
        // Tarmoq uzilishi (net::ERR_NETWORK_CHANGED — Wi-Fi almashdi, VPN, IP
        // yangilandi). Bu TALABANING aybi emas: qoidabuzarlik yozilmaydi va
        // identityFailCount ham oshmaydi. Lekin keyingi tekshiruvgacha
        // IDENTITY_CHECK_MS (90s) proctoring bo'shlig'i qolmasin — bir marta
        // tez qayta urinamiz.
        setIdStatus('idle');
        if (!retriedRef.current) {
          retriedRef.current = true;
          identityCheckBusyRef.current = false;
          window.setTimeout(() => {
            if (!bannedRef.current && sessionStartedRef.current) void runCheck();
          }, 4000);
          return;
        }
      } finally {
        identityCheckBusyRef.current = false;
      }
      retriedRef.current = false;
    };

    triggerIdentityCheckRef.current = () => { void runCheck(); };
    const id = window.setInterval(runCheck, IDENTITY_CHECK_MS);
    void runCheck();
    return () => {
      clearInterval(id);
      if (identityStatusTimerRef.current !== null) clearTimeout(identityStatusTimerRef.current);
    };
  }, [banned, user.profile_image, nextGuardHeaders, sessionStarted]);

  // --- Tab / visibility (masofaviy nazorat) ---
  // Oyna yashiringan holati (document.visibilityState === 'hidden') — DAVOMIY holat,
  // shu sabab u ham yagona darvoza (eventGateRef) orqali qonunga bo'ysunadi: 4s uzluksiz
  // boshqa oynada qolsa rasmiy (TAB_SWITCH_HARD). Poll markazlashgan gate tick loopida.
  // Bu yerda faqat pagehide (sahifadan chiqib ketish) — bu terminal hodisa, kutib
  // bo'lmaydi, shu sabab darhol yozib qoldiramiz (eng oxirgi signal).
  useEffect(() => {
    const onPageHide = () => {
      if (bannedRef.current || !sessionStartedRef.current) return;
      if (Date.now() < blurIgnoreUntilRef.current) return;
      void logViolationRef.current('TAB_SWITCH_SOFT');
    };
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
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
            // TIL MAJBURIY: `auto` tilli imtihonda savollar talabaning UI tilida
            // beriladi (/start `X-Student-Lang` bilan), lekin submit'da bu sarlavha
            // yuborilmasdi va server "uz" ga qaytardi — talaba ru/en da yechgan
            // bo'lsa javoblari boshqa tildagi variantlar bilan solishtirilardi.
            'X-Student-Lang': langRef.current,
            ...(await nextGuardHeaders('POST', `/api/student/exams/${exam.id}/submit`)),
          },
          body: JSON.stringify({
            answers: ans,
            flaggedQuestions: fl,
            student_lang: langRef.current,
          }),
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
          student_group: user.group_name || '',
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

  const startExamSession = useCallback(async () => {
    if (startingSession || sessionStartedRef.current) return;
    setStartingSession(true);
    setStartError('');
    try {
      if (document.documentElement.requestFullscreen && !document.fullscreenElement) {
        requestExamFullscreen();
      }
      if (audioContextRef.current?.state === 'suspended') {
        await audioContextRef.current.resume().catch(() => {});
      }
      const res = await fetch(apiUrl(`/api/student/exams/${exam.id}/start`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Student-Lang': langRef.current,
          ...examAuthHeaders(token),
        },
        body: JSON.stringify({ pin: exam.preExamPin || '', student_lang: langRef.current }),
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
        setStartError(data?.error || t.preExamStartError);
        return;
      }
      if (data.deviceToken) {
        setDeviceSessionToken(data.deviceToken);
      }
      const merged = {
        ...data.exam,
        startedAt: data.startedAt,
        sessionKey: data.sessionKey,
        sessionSeqStart: data.sessionSeqStart,
        sessionChallenge: data.sessionChallenge,
        preExamPin: exam.preExamPin,
      };
      setExam(merged);
      setStudentExamId(data.studentExamId);
      vacStateRef.current = {
        seq: Number(data.sessionSeqStart || 1),
        challengeSeed: data.sessionChallenge,
      };
      setTimeLeft(merged.duration_minutes * 60);
    } catch {
      setStartError(t.preExamNetworkError);
    } finally {
      setStartingSession(false);
    }
  }, [exam.id, exam.preExamPin, startingSession, t.preExamNetworkError, t.preExamStartError, token, requestExamFullscreen]);

  // Vaqt tugaganda darhol topshirish (sahifa yuklanganda ham)
  useEffect(() => {
    if (banned || submittingRef.current || !sessionStarted) return;
    if (timeLeft <= 0) {
      void runSubmitCore(answersRef.current, flaggedRef.current);
    }
  }, [banned, timeLeft, runSubmitCore, sessionStarted]);

  // --- Countdown (oxirgi javoblar ref orqali) ---
  useEffect(() => {
    if (banned || !sessionStarted) return;
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
  }, [banned, runSubmitCore, sessionStarted]);

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
                blurIgnoreUntilRef.current = Date.now() + 2000;
                postWarningGraceUntilRef.current = Date.now() + 8000;
                setWarningQueue([]);
                fullscreenSuppressRef.current = true;
                needsFullscreenRef.current = false;
                setNeedsFullscreen(false);
                requestExamFullscreen();
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
    const remaining = Math.max(0, maxOfficialWarnings - warnNum);

    const warnTitle = t.violationWarningTitle.replace('{n}', String(warnNum));
    const warnContinue = t.violationContinueExam;
    const reasonLabel = t.violationReasonLabel;
    const bannerText = isFinal
      ? t.violationFinalBanner
      : t.violationRemainingBanner.replace('{n}', String(remaining));

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

            <div className={`rounded-lg px-3 py-2.5 mb-4 text-center text-sm font-semibold leading-snug ${
              isFinal
                ? 'bg-red-600 text-white'
                : 'bg-orange-100 text-orange-900 border border-orange-300'
            }`}>
              {isFinal ? `⛔ ${bannerText}` : `⚠ ${bannerText}`}
            </div>

            <div className="bg-white rounded-xl sm:rounded-lg px-4 py-3 sm:px-5 sm:py-4 mb-4 text-center border border-gray-200">
              <p className="text-[10px] sm:text-xs text-gray-500 mb-1 uppercase tracking-wide font-medium">{reasonLabel}</p>
              <p className="text-sm sm:text-base font-semibold text-gray-800 break-words">{violationWarning.reason}</p>
            </div>

            <div className="mb-4">
              <WarningStepRow
                warningCount={warnNum}
                maxWarnings={maxOfficialWarnings}
                banReached={false}
                isFinalPending={isFinal}
                t={t}
              />
            </div>

            <ViolationHistoryList history={warningHistory} label={t.banWarningHistoryLabel} />

            {isFinal ? (
              <p className="text-[11px] sm:text-xs text-red-800/90 text-center mb-4 font-medium leading-relaxed">
                {t.violationFinalNotice}
              </p>
            ) : null}

            <p className="text-[11px] sm:text-xs text-gray-500 text-center mb-4 sm:mb-5 leading-relaxed">{t.violationFooterHonest}</p>
          </div>

          <div className="shrink-0 border-t border-black/5 p-4 sm:p-5 pt-3 sm:pt-4 bg-white rounded-b-2xl sm:rounded-b-3xl">
            <button
              type="button"
              onClick={resumeAfterViolationAck}
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

  // --- Qoidabuzarlik qayta topshirish ekrani ---
  if (examRetakeNotice != null) {
    const reasonText = examRetakeNotice.reason || t.violationReasonLabel;
    return <>{createPortal(
      <div
        className="fixed inset-0 z-[10050] flex items-center justify-center bg-black/50 overflow-y-auto px-4 py-8"
        role="dialog"
        aria-modal="true"
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-lg my-auto"
        >
          <div className="w-full text-center p-6 sm:p-8 rounded-lg border border-amber-200 bg-amber-50/95 shadow-2xl">
            <div className="w-20 h-20 bg-amber-100 text-amber-700 rounded-full flex items-center justify-center mx-auto mb-6">
              <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-amber-800 mb-4">{t.technicalRetakeTitle}</h2>
            <div className="text-left rounded-lg border border-amber-200 bg-white/80 px-4 py-3 mb-4">
              <p className="text-[11px] font-bold uppercase tracking-wide text-amber-700 mb-1.5">
                {t.technicalRetakeViolationLabel}
              </p>
              <p className="text-[14px] font-semibold text-gray-900 leading-relaxed">{reasonText}</p>
            </div>
            <ViolationHistoryList history={warningHistory} label={t.banWarningHistoryLabel} />
            <p className="text-gray-800 mb-2 leading-relaxed text-sm font-semibold">
              {t.technicalRetakeUsedRemaining
                .replace('{used}', String(examRetakeNotice.used))
                .replace('{remaining}', String(examRetakeNotice.remaining))}
            </p>
            <p className="text-gray-600 mb-6 leading-relaxed text-sm">{t.technicalRetakeBody}</p>
            {/* Yiqilganda majburiy qayta boshlash YO'Q — asosiy tugma bosh sahifaga
                qaytaradi; talaba imtihon vaqti tugamaguncha panelidan istalgan vaqtda
                qayta boshlaydi. Xohlasa, shu yerdan darhol ham boshlashi mumkin. */}
            <AdminBtn variant="blue" size="lg" className="w-full" onClick={() => onFinish(null)}>
              {t.technicalRetakeBackBtn}
            </AdminBtn>
            {onRetakeRestart ? (
              <button
                type="button"
                onClick={() => onRetakeRestart()}
                className="w-full mt-2.5 text-[13px] font-medium text-amber-700 hover:text-amber-800 underline underline-offset-2"
              >
                {t.technicalRetakeRestartNow}
              </button>
            ) : null}
          </div>
        </motion.div>
      </div>,
      document.body,
    )}</>;
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

          {banReasonLabel(lang, banReasonCode) ? (
            <div className="mb-4 rounded-lg border border-red-200 bg-white px-4 py-3 text-left">
              <p className="text-[10px] uppercase tracking-wide text-red-700/80 font-semibold mb-1">
                {t.banReasonTitle}
              </p>
              <p className="text-sm font-semibold text-gray-900">{banReasonLabel(lang, banReasonCode)}</p>
            </div>
          ) : null}

          <div className="mb-5 rounded-xl border border-red-200 bg-white px-4 py-4 text-left space-y-4">
            <p className="text-sm font-bold text-red-800">{t.banProgressTitle}</p>
            <p className="text-[13px] text-gray-700 leading-relaxed">{t.banStepsExplainer}</p>
            <WarningStepRow
              warningCount={maxOfficialWarnings}
              maxWarnings={maxOfficialWarnings}
              banReached
              t={t}
            />
            {banLastReason ? (
              <div className="rounded-lg border border-red-100 bg-red-50/80 px-3 py-2.5">
                <p className="text-[10px] uppercase tracking-wide text-red-700/80 font-semibold mb-1">
                  {t.banLastViolationLabel}
                </p>
                <p className="text-sm font-semibold text-gray-900 break-words">{banLastReason}</p>
              </div>
            ) : null}
            {warningHistory.length > 0 ? (
              <div>
                <p className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold mb-2">
                  {t.banWarningHistoryLabel}
                </p>
                <ul className="space-y-1.5 text-[13px] text-gray-700">
                  {warningHistory.map((w) => (
                    <li key={w.number} className="flex gap-2">
                      <span className="shrink-0 font-bold text-orange-700">{w.number}.</span>
                      <span className="break-words">{w.reason}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>

          {banViolationsCount != null && (
            <p className="text-sm text-red-800/90 font-medium mb-5">
              {t.banRecordCountHint.replace('{n}', String(banViolationsCount))}
            </p>
          )}

          {unblockReady && (
            <div className="mb-5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-left space-y-3">
              <p className="text-sm text-emerald-800 font-medium">{t.unblockAllowedMsg}</p>
              <AdminBtn variant="emerald" size="lg" className="w-full" onClick={continueAfterUnblock}>
                {t.resumeExam}
              </AdminBtn>
            </div>
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
                    headers: { ...examAuthHeaders(token), 'X-Student-Lang': langRef.current },
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
            <p className="text-[13px] font-semibold text-gray-800">{t.banAppealTitle}</p>
            {myAppeals.length > 0 && (
              <div className="rounded-lg border border-gray-200 bg-gray-50/80 p-3 space-y-2">
                <p className="text-[12px] font-semibold text-gray-700">{t.banAppealHistoryTitle}</p>
                {myAppeals.map((a) => (
                  <div key={a.id} className="text-[12px] text-gray-600 border-t border-gray-200/80 pt-2 first:border-0 first:pt-0">
                    <span className={`font-semibold ${
                      a.status === 'Approved' ? 'text-emerald-700' :
                      a.status === 'Rejected' ? 'text-red-700' : 'text-amber-700'
                    }`}>
                      {a.status === 'Approved' ? t.banAppealStatusApproved :
                        a.status === 'Rejected' ? t.banAppealStatusRejected : t.banAppealStatusPending}
                    </span>
                    {a.created_at && (
                      <span className="text-gray-400 ml-2">{new Date(a.created_at).toLocaleString()}</span>
                    )}
                    <p className="mt-1 text-gray-700 line-clamp-3">{a.reason}</p>
                    {a.review_note && <p className="mt-1 text-gray-500 italic">{a.review_note}</p>}
                  </div>
                ))}
              </div>
            )}
            <textarea
              value={appealReason}
              onChange={(e) => setAppealReason(e.target.value)}
              placeholder={t.banAppealPlaceholder}
              className="w-full min-h-[80px] rounded-lg border border-gray-200 bg-white px-3 py-2 text-[13px] resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500/25 focus:border-indigo-500 transition-colors"
            />
            <p className={`text-[11px] text-right ${appealReason.trim().length >= 12 ? 'text-emerald-600' : 'text-gray-400'}`}>
              {appealReason.trim().length}/12 {t.banAppealMinChars}
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
                    setAppealMsg(data?.error || t.banAppealSubmitError);
                    return;
                  }
                  setAppealMsg(`ok:${t.banAppealSubmitOk}`);
                  setAppealReason('');
                  const listRes = await fetch(apiUrl('/api/student/ban-appeals'), { headers: examAuthHeaders(token) });
                  const listData = await readJsonSafe<typeof myAppeals>(listRes);
                  if (Array.isArray(listData)) {
                    setMyAppeals(listData.filter((a) => a.exam_id === exam.id));
                  }
                } finally {
                  setAppealBusy(false);
                }
              }}
            >
              {appealBusy ? t.banAppealSending : t.banAppealSubmitBtn}
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
    OK:             { label: EXAM_L[lang].faceOk,       border: 'border-green-400',  bg: 'bg-green-500/90',  text: 'text-white', icon: '✓' },
    WAITING:        { label: EXAM_L[lang].faceWaiting, border: 'border-gray-300',   bg: 'bg-gray-700/80',   text: 'text-white', icon: '⋯' },
    NO_FACE:        { label: EXAM_L[lang].faceNoFace,  border: 'border-red-500',    bg: 'bg-red-600/90',    text: 'text-white', icon: '⚠' },
    MULTIPLE_FACES: { label: EXAM_L[lang].faceMulti,   border: 'border-red-500',    bg: 'bg-red-600/90',    text: 'text-white', icon: '⚠' },
    TOO_FAR:        { label: EXAM_L[lang].faceTooFar,  border: 'border-amber-400',  bg: 'bg-amber-500/90',  text: 'text-white', icon: '↔' },
    TOO_CLOSE:      { label: EXAM_L[lang].faceTooClose, border: 'border-amber-400', bg: 'bg-amber-500/90',  text: 'text-white', icon: '↔' },
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
    <div className="h-[100dvh] flex flex-col bg-gray-50 overflow-hidden select-none">
      {/* ── Majburiy fullscreen gate (kiosk) ── */}
      <AnimatePresence>
        {needsFullscreen && !banned && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[10060] flex items-center justify-center bg-slate-900/95 backdrop-blur-sm px-5"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.94, y: 14 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 26 }}
              className="w-full max-w-md text-center rounded-2xl bg-white p-7 sm:p-9 shadow-2xl"
            >
              <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-100 text-indigo-600">
                <svg className="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" /></svg>
              </div>
              <h2 className="text-xl font-bold text-slate-900">{t.examFullscreenGateTitle}</h2>
              <p className="mt-2 text-sm text-slate-500 leading-relaxed">{t.examFullscreenGateBody}</p>
              <button
                type="button"
                onClick={requestExamFullscreen}
                className="mt-6 w-full rounded-xl bg-indigo-600 py-3.5 font-semibold text-white shadow-lg shadow-indigo-500/25 transition-all hover:bg-indigo-700 active:scale-[0.98]"
              >
                {t.examFullscreenGateBtn}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Yuqori panel: sarlavha + progress + taymer + topshirish ── */}
      <header className="shrink-0 bg-white border-b border-gray-200 shadow-sm">
        <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-[1.125rem] grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] items-center gap-3 sm:gap-5 min-h-[4.25rem]">
          <div className="min-w-0 sm:justify-self-start">
            <h1 className="text-base sm:text-lg font-bold tracking-tight text-gray-900 truncate leading-tight">{exam.title}</h1>
            <p className="text-[11px] sm:text-xs text-gray-400 truncate mt-0.5">
              {user.name}
              {user.group_name ? ` · ${user.group_name}` : ''}
            </p>
            {sessionStarted && (
              <div className="flex items-center gap-2 mt-1.5">
                <div className="hidden sm:block flex-1 h-2 bg-gray-200 rounded-full overflow-hidden max-w-[220px]">
                  <div className="h-full bg-indigo-500 transition-all duration-500 ease-out" style={{ width: `${progress}%` }} />
                </div>
                <span className="text-xs font-medium text-gray-500 whitespace-nowrap">
                  {t.questionProgress
                    .replace('{cur}', String(qIndex + 1))
                    .replace('{total}', String(totalQuestions))
                    .replace('{answered}', String(answeredCount))}
                </span>
              </div>
            )}
          </div>
          <div className={`flex flex-col items-center justify-center leading-none sm:justify-self-center ${timeLeft < 300 && sessionStarted ? 'text-red-600' : 'text-gray-700'}`}>
            <span className="text-[10px] font-semibold uppercase tracking-wider opacity-70 mb-1">{t.timeRemaining}</span>
            <span className="font-mono text-2xl sm:text-[1.75rem] font-bold tabular-nums leading-none">
              {sessionStarted ? formatTime(timeLeft) : formatTime(exam.duration_minutes * 60)}
            </span>
          </div>
          <div className="hidden sm:block sm:justify-self-end" aria-hidden />
        </div>
      </header>

      {/* ── Asosiy tana: chapda savol, o'ngda proctoring paneli ── */}
      <div className="flex-1 min-h-0 w-full max-w-7xl mx-auto flex flex-col gap-2.5 p-3 sm:p-4 overflow-y-auto lg:overflow-hidden">
        {sessionStarted && !banned && (
          <div className="shrink-0 flex flex-col gap-2.5">
            <AnimatePresence>
              {timeLeft <= 0 && (
                <motion.div
                  initial={{ opacity: 0, y: -12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  className="shrink-0 bg-red-500/10 border border-red-400/30 text-red-800 px-4 py-2.5 rounded-lg shadow-sm text-sm font-medium"
                >
                  {t.examTimeExpiredHint}
                </motion.div>
              )}
              {showTimeWarning && (
                <motion.div
                  initial={{ opacity: 0, y: -20, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="shrink-0 bg-orange-500/10 border border-orange-500/20 text-orange-700 px-4 py-2.5 rounded-lg relative flex items-center gap-3 shadow-sm"
                >
                  <svg className="w-5 h-5 text-orange-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  <div>
                    <strong className="font-semibold block text-sm">{t.timeWarningTitle}</strong>
                    {t.timeWarningBody.trim() ? <span className="text-xs">{t.timeWarningBody}</span> : null}
                  </div>
                </motion.div>
              )}
              {isOffline && (
                <motion.div
                  initial={{ opacity: 0, y: -20, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="shrink-0 bg-yellow-500/10 border border-yellow-500/20 text-yellow-700 px-4 py-2.5 rounded-lg relative flex items-center gap-3 shadow-sm"
                >
                  <svg className="w-5 h-5 text-yellow-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                  <div>
                    <strong className="font-semibold block text-sm">{t.connectionLostTitle}</strong>
                    {t.connectionLostBody.trim() ? <span className="text-xs">{t.connectionLostBody}</span> : null}
                  </div>
                </motion.div>
              )}
              {!isOffline && realtimeSyncOffline && !realtimeBannerDismissed && (
                <motion.div
                  initial={{ opacity: 0, y: -20, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="shrink-0 bg-amber-50 border border-amber-200 text-amber-950 px-4 py-3 rounded-lg shadow-sm flex items-start gap-3"
                >
                  <svg className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  <div className="flex-1 min-w-0">
                    <strong className="font-semibold block text-sm">{t.realtimeSyncOfflineTitle}</strong>
                    <span className="text-xs text-amber-900/90">{t.realtimeSyncOfflineBodyShort}</span>
                    <div className="flex flex-wrap gap-2 mt-2">
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
          </div>
        )}

        <div className="flex flex-col lg:flex-row lg:items-start gap-3 lg:flex-1 lg:min-h-0">
        {/* Chap ustun: lobby yoki savollar */}
        <div className={`flex flex-col gap-2.5 lg:flex-1 lg:min-h-0 min-w-0 ${!sessionStarted && !banned ? 'lg:justify-center' : 'lg:justify-start'}`}>
          {!sessionStarted && !banned ? (
            <div className="flex-1 flex flex-col items-center justify-center py-6 lg:py-10">
              <div className="w-full max-w-lg rounded-2xl border border-gray-200 bg-white shadow-sm p-6 sm:p-8 text-center space-y-4">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-100 text-indigo-600">
                  <svg className="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
                </div>
                <div>
                  <h2 className="text-xl sm:text-2xl font-bold text-gray-900">{t.examLobbyTitle}</h2>
                  <p className="mt-2 text-sm text-gray-500 leading-relaxed">{t.examLobbyHint}</p>
                  <p className="mt-3 text-sm font-medium text-indigo-700 tabular-nums">
                    {exam.duration_minutes} {t.minutesShort} · {t.examLobbyQuestionCount.replace('{n}', String(totalQuestions))}
                  </p>
                </div>
                {startError && (
                  <AdminAlert type="error">{startError}</AdminAlert>
                )}
                <AdminBtn
                  variant="blue"
                  size="lg"
                  loading={startingSession}
                  onClick={() => void startExamSession()}
                  className="w-full sm:px-10"
                >
                  {startingSession ? t.preExamStarting : t.takeExam}
                </AdminBtn>
              </div>
            </div>
          ) : (
          <>
          {warningMsgModal}

          {/* Savol kartasi — faqat variantlar ro'yxati ichida scroll bo'ladi */}
          {currentQ && (
            <motion.div
              key={currentQ.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              id={`question-${currentQ.id}`}
              className={`flex flex-col rounded-xl border bg-white overflow-hidden shadow-sm transition-all lg:flex-1 lg:min-h-0 ${flaggedQuestions.includes(currentQ.id) ? 'border-amber-300 ring-2 ring-amber-200' : 'border-gray-200'}`}
            >
              <div className="shrink-0 bg-gray-50/80 border-b border-gray-100 px-4 sm:px-5 py-3 flex items-start justify-between gap-3">
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
              <div className="p-3 sm:p-4 space-y-2.5 lg:flex-1 lg:min-h-0 lg:overflow-y-auto lg:overscroll-y-contain">
                {currentQParsed.images.map((img, idx) => (
                  <div key={`${currentQ.id}-img-${idx}`} className="mb-3">
                    <img
                      src={img}
                      alt={`Question ${qIndex + 1} image ${idx + 1}`}
                      className="max-h-60 w-auto rounded-xl border border-slate-200"
                      referrerPolicy="no-referrer"
                    />
                  </div>
                ))}
                {currentOptions.map((opt: string, optIndex: number) => (
                  <label
                    key={`${currentQ.id}-opt-${optIndex}`}
                    className={`flex items-center gap-3 sm:gap-4 p-3 sm:p-4 rounded-lg cursor-pointer transition-all duration-200 border ${
                      answers[String(currentQ.id)] === opt
                        ? 'bg-indigo-50 border-indigo-300 shadow-sm ring-1 ring-indigo-200'
                        : 'bg-white border-slate-200 hover:border-indigo-200 hover:bg-indigo-50/40'
                    }`}
                  >
                    <div className={`w-8 h-8 sm:w-9 sm:h-9 rounded-xl flex items-center justify-center flex-shrink-0 text-sm font-bold transition-colors ${
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

              {/* Navigatsiya — savol kartasi ichida, doim ko'rinib turadi */}
              <div className="shrink-0 flex items-center justify-between gap-3 px-3 sm:px-4 py-2.5 border-t border-gray-100 bg-gray-50/60">
                <AdminBtn
                  variant="ghost"
                  size="md"
                  disabled={qIndex <= 0}
                  onClick={() => setQIndex((i) => Math.max(0, i - 1))}
                  icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>}
                >
                  {t.examNavPrev}
                </AdminBtn>
                <span className="text-[12px] font-medium text-gray-400 tabular-nums shrink-0">{qIndex + 1} / {totalQuestions}</span>
                {/* Oxirgi savolda "Keyingi" o'rniga "Yakunlash" — o'chiq (disabled)
                    tugma turishi talabani boshi berk ko'chaga olib borardi: oldinga
                    yo'l yo'q, yakunlash tugmasi esa o'ng panelda, ko'zga tashlanmaydi. */}
                {qIndex >= totalQuestions - 1 ? (
                  <AdminBtn
                    variant="blue"
                    size="md"
                    loading={submitting}
                    // Tasdiqlash MAJBURIY: talaba shu tugmani "Keyingi" deb ketma-ket
                    // bosib kelgan, oxirgi savolda ortiqcha bosish imtihonni
                    // qaytarib bo'lmaydigan tarzda yakunlab qo'yishi mumkin edi.
                    onClick={() => setSubmitConfirm(true)}
                    iconRight={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>}
                  >
                    {submitting ? t.submitting : t.submitExam}
                  </AdminBtn>
                ) : (
                  <AdminBtn
                    variant="blue"
                    size="md"
                    onClick={() => setQIndex((i) => Math.min(totalQuestions - 1, i + 1))}
                    iconRight={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>}
                  >
                    {t.examNavNext}
                  </AdminBtn>
                )}
              </div>
            </motion.div>
          )}
          </>
          )}
        </div>

        {/* O'ng panel: kamera + (faqat boshlangandan keyin) savollar */}
        <aside className="w-full lg:w-[17.5rem] xl:w-72 shrink-0 flex flex-col gap-2 lg:sticky lg:top-3">
          {(() => {
            const fsCfg = FACE_STATUS_CFG[faceStatus] ?? FACE_STATUS_CFG.WAITING;
            const isOk = faceStatus === 'OK';
            const isWaiting = faceStatus === 'WAITING';
            return (
              <div className="shrink-0 bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
                <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${isOk ? 'bg-green-500' : 'bg-red-500 animate-pulse'}`} />
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 truncate">{t.examPanelCamera}</span>
                  </div>
                  {!isWaiting && (
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-md shrink-0 ${isOk ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>
                      {fsCfg.label}
                    </span>
                  )}
                </div>
                {liveSignalLabel && (
                  <div className="px-3 py-1.5 bg-amber-50 border-b border-amber-100 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse shrink-0" />
                    <span className="text-[11px] font-medium text-amber-800 truncate">{liveSignalLabel}</span>
                  </div>
                )}
                {audioLiveLabel && (
                  <div className="px-3 py-1.5 bg-sky-50 border-b border-sky-100 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-sky-500 animate-pulse shrink-0" />
                    <span className="text-[11px] font-medium text-sky-800 truncate">{audioLiveLabel}</span>
                  </div>
                )}
                {eventLiveLabel && (
                  <div className="px-3 py-1.5 bg-rose-50 border-b border-rose-100 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse shrink-0" />
                    <span className="text-[11px] font-medium text-rose-800 truncate">{eventLiveLabel}</span>
                  </div>
                )}
                <div className="p-2 pb-2">
                  <div className={`rounded-lg overflow-hidden bg-black/5 border-2 relative aspect-[4/3] max-h-[200px] mx-auto transition-colors duration-300 ${fsCfg.border}`}>
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
                    {!cameraErrorHint && cameraPreviewOk && identityStatus !== 'idle' && (
                      <div className="absolute top-2 right-2">
                        <div className={`flex items-center gap-1 px-1.5 py-1 rounded-md text-[10px] font-bold ${
                          identityStatus === 'checking' ? 'bg-blue-600/90 text-white' :
                          identityStatus === 'ok'       ? 'bg-emerald-600/90 text-white' :
                                                          'bg-red-600/90 text-white'
                        }`}>
                          {identityStatus === 'checking' ? 'ID…' : identityStatus === 'ok' ? 'ID ✓' : 'ID ✗'}
                        </div>
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

          {sessionStarted && (
          <>
          <div className="flex flex-col bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
            <div className="shrink-0 px-3 py-2 border-b border-gray-100 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">{t.examPanelQuestions}</span>
              <span className="text-[11px] font-semibold text-gray-400 tabular-nums">{answeredCount}/{totalQuestions}</span>
            </div>
            <div className="p-2.5">
              <div className="grid grid-cols-5 gap-1.5">
                {examQuestions.map((q: any, i: number) => {
                  const isAnswered = !!answers[q.id];
                  const isFlagged = flaggedQuestions.includes(q.id);
                  const isCurrent = i === qIndex;
                  return (
                    <button
                      type="button"
                      key={q.id}
                      onClick={() => setQIndex(i)}
                      className={`h-9 w-full rounded-md flex items-center justify-center text-xs font-semibold transition-all ${
                        isCurrent ? 'ring-2 ring-offset-1 ring-indigo-500' : ''
                      } ${
                        isFlagged ? 'bg-yellow-100 text-yellow-700 border-2 border-yellow-400' :
                        isAnswered ? 'bg-indigo-500 text-white shadow-md shadow-indigo-500/20' :
                        'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      {i + 1}
                    </button>
                  );
                })}
              </div>
              <div className="mt-2 pt-2 border-t border-gray-100 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[10px] text-gray-500">
                <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded bg-indigo-500" />{EXAM_L[lang].answered}</span>
                <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded bg-yellow-100 border border-yellow-400" />{EXAM_L[lang].flagged}</span>
                <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded bg-white border border-gray-300" />{EXAM_L[lang].empty}</span>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
            <div className="px-3 py-2 flex items-center justify-between border-b border-gray-100">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">{t.examPanelWarnings}</span>
              <div className="flex items-center gap-1">
                {[1, 2, 3].map(num => (
                  <div
                    key={num}
                    className={`w-2.5 h-2.5 rounded-full transition-colors ${
                      strikeLevel >= num ? 'bg-red-500' : 'bg-gray-200'
                    }`}
                  />
                ))}
              </div>
            </div>
            <div className="p-2.5">
              <AdminBtn
                variant="blue"
                size="md"
                loading={submitting}
                onClick={handleSubmit}
                className="w-full"
              >
                {submitting ? t.submitting : t.submitExam}
              </AdminBtn>
            </div>
          </div>
          </>
          )}
        </aside>
        </div>
      </div>
      <Calculator />

      {/* Kichik ogohlantirish modali — chip ustida, talaba tasdiqlashi uchun.
          Rasmiy/ban modallari ustunroq (ular ochiq bo'lsa buni ko'rsatmaymiz). */}
      {smallWarn && !violationWarning && !banned && !hardBlocked && createPortal(
        <div
          className="fixed inset-0 z-[10035] flex items-center justify-center px-4 pointer-events-none"
          role="alertdialog"
          aria-modal="false"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            className="pointer-events-auto w-full max-w-sm rounded-xl border border-amber-300 bg-amber-50 shadow-2xl p-4"
          >
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 shrink-0 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-wide text-amber-700">
                  {t.smallWarnTitle}
                </p>
                <p className="text-sm font-semibold text-amber-900 mt-0.5 break-words">
                  {smallWarn.text}
                </p>
                <p className="text-[12px] text-amber-800/80 mt-1 leading-snug">{t.smallWarnHint}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={dismissSmallWarn}
              className="mt-3 w-full rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold py-2 transition-colors"
            >
              {t.violationContinueExam}
            </button>
          </motion.div>
        </div>,
        document.body,
      )}

      {/* Yakunlashni tasdiqlash — javobsiz savollar sonini ko'rsatadi */}
      {submitConfirm && createPortal(
        <div
          className="fixed inset-0 z-[10050] flex items-center justify-center bg-black/50 overflow-y-auto px-4 py-8"
          role="dialog"
          aria-modal="true"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-md my-auto"
          >
            <div className="w-full p-6 rounded-xl border border-gray-200 bg-white shadow-2xl">
              <h2 className="text-lg font-bold text-gray-900 mb-3">{t.submitConfirmTitle}</h2>
              <p
                className={`text-sm font-semibold mb-1.5 ${
                  answeredCount >= totalQuestions ? 'text-green-700' : 'text-amber-700'
                }`}
              >
                {answeredCount >= totalQuestions
                  ? t.submitConfirmAllAnswered.replace('{total}', String(totalQuestions))
                  : t.submitConfirmUnanswered
                      .replace('{n}', String(totalQuestions - answeredCount))
                      .replace('{total}', String(totalQuestions))}
              </p>
              <p className="text-sm text-gray-600 mb-5">{t.submitConfirmWarning}</p>
              <div className="flex flex-col-reverse sm:flex-row gap-2">
                <AdminBtn
                  variant="ghost"
                  size="md"
                  className="sm:flex-1"
                  onClick={() => setSubmitConfirm(false)}
                >
                  {t.submitConfirmNo}
                </AdminBtn>
                <AdminBtn
                  variant="blue"
                  size="md"
                  className="sm:flex-1"
                  loading={submitting}
                  onClick={() => {
                    setSubmitConfirm(false);
                    handleSubmit();
                  }}
                >
                  {t.submitConfirmYes}
                </AdminBtn>
              </div>
            </div>
          </motion.div>
        </div>,
        document.body,
      )}
    </div>
  );
}
