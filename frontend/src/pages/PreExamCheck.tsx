import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { translations, Language, formatPreExamMediaAccessFailure } from '../i18n';
import { readJsonSafe } from '../lib/http';
import { apiUrl } from '../lib/apiUrl';
import { examAuthHeaders, setDeviceSessionToken } from '../lib/deviceFingerprint';
import { compressVideoFrameToJpeg } from '../lib/compressToJpeg';
import { FacePositionChecker, LivenessChallengeTracker, type FacePositionStatus } from '../lib/facePositionCheck';
import { type LivenessAction } from '../lib/livenessChallenge';
import {
  classifyImageQuality,
  eyeBaselineFrom,
  classifyNetwork,
  computeImageStats,
  grayscaleFromCanvas,
  type NetworkStatus,
  type QualityStatus,
} from '../lib/mediaQualityCheck';
import { IdentityVerifiedSuccess } from '../components/IdentityVerifiedSuccess';
import { AdminBtn, AdminAlert, AdminInput } from './admin/ui';
import { Check } from 'lucide-react';

/* Sahifa ichidagi qisqa matnlar (uz/ru/en) — katta i18n fayliga tegmasdan. */
const PRE_L: Record<Language, Record<string, string>> = {
  uz: { stepCamera: 'Kamera', stepIdentity: 'Shaxs', stepLiveness: 'Jonlilik' },
  ru: { stepCamera: 'Камера', stepIdentity: 'Личность', stepLiveness: 'Живость' },
  en: { stepCamera: 'Camera', stepIdentity: 'Identity', stepLiveness: 'Liveness' },
};
import {
  attachDefaultMicrophone,
  openCameraByTryingVideoInputs,
  openPreferredCameraStream,
  VIRTUAL_CAMERA_BLOCKED_MESSAGE,
} from '../lib/preferredCameraStream';
import { prewarmProctorStream, discardPrewarmedProctorStream } from '../lib/proctorStreamPrewarm';

const PASSIVE_LIVE_SAMPLES = 12;
const PASSIVE_LIVE_GAP_MS = 260;
const PASSIVE_LIVE_THRESHOLD = 400;
const LIVENESS_W = 80;
const LIVENESS_H = 60;

// Active liveness challenge (tabassum) — passiv piksel-farq tekshiruvidan keyin.
/** Harakat → talabaga ko'rsatiladigan ko'rsatma (i18n kaliti). */
const LIVENESS_PROMPT_KEY = {
  BLINK: 'preExamChallengeBlink',
  SMILE: 'preExamChallengeSmile',
  MOUTH_OPEN: 'preExamChallengeMouth',
  TURN_LEFT: 'preExamChallengeTurnLeft',
  TURN_RIGHT: 'preExamChallengeTurnRight',
} as const satisfies Record<LivenessAction, string>;

/** Kadr yoritilishi/piksel yig'indisi o'zgarishi — foydalanuvchi harakat yoki tabiiy harakat */
async function samplePassiveFrameMotion(captureFrame: () => number): Promise<boolean> {
  let maxDelta = 0;
  let prev = 0;
  for (let i = 0; i < PASSIVE_LIVE_SAMPLES; i++) {
    await new Promise((r) => setTimeout(r, PASSIVE_LIVE_GAP_MS));
    const cur = captureFrame();
    if (cur > 0 && prev > 0) {
      maxDelta = Math.max(maxDelta, Math.abs(cur - prev));
    }
    if (cur > 0) prev = cur;
  }
  return maxDelta >= PASSIVE_LIVE_THRESHOLD;
}

export function PreExamCheck({
  exam,
  token,
  user,
  lang,
  isRetake,
  onComplete,
  onCancel,
}: {
  exam: any;
  token: string;
  user: any;
  lang: Language;
  /** Qoidabuzarlik tufayli qayta topshirish uchun qaytadan kirilganmi — true bo'lsa pozitsiya gate talab qilinmaydi. */
  isRetake?: boolean;
  onComplete: (examData: any, seId: number) => void;
  onCancel: () => void;
}) {
  // Retake holatini faqat transient prop'dan emas, exam ma'lumotidan ham aniqlaymiz —
  // shunda retake PreExamCheck'da brauzer yangilansa ham (prop yo'qolsa) pozitsiya gate
  // qayta talab qilinmaydi. Shaxs (identity) va jonlilik har safar tekshiriladi.
  const isRetakeResolved = Boolean(
    isRetake ||
      exam?.session_phase === 'after_retake' ||
      (exam?.technical_retakes_used ?? 0) > 0 ||
      (exam?.identity_retakes_used ?? 0) > 0,
  );
  const [cameraReady, setCameraReady] = useState(false);
  const [micReady, setMicReady] = useState(false);
  const [error, setError] = useState('');
  const [identityError, setIdentityError] = useState('');
  const [starting, setStarting] = useState(false);

  /**
   * Imtihon muddati tugadimi — sahifa QULFLANADI.
   *
   * Muammo: imtihon oldi tekshiruvi (kamera, shaxs tasdiqlash, jonlilik) bir
   * necha daqiqa oladi. Shu vaqtda imtihon tugab qolishi mumkin edi va talaba
   * hamma bosqichni o'tib, oxirida `/start` dan "Imtihon allaqachon tugagan"
   * xatosini olardi — kamera esa ochiq qolar, "Kirish" tugmasi bosilaverar,
   * har urinishda shaxs tasdiqlash (server + AI) qayta sarflanardi.
   *
   * Muddat `access_until` dan olinadi: umumiy tugash vaqti yoki faol retake
   * oynasining oxiri (qaysi kechroq). `end_time` ga qarab bo'lmaydi — retake
   * oynasi berilgan talaba umumiy vaqtdan keyin ham haqli ravishda kiradi.
   */
  const accessUntilMs = (() => {
    const raw = exam?.access_until || exam?.end_time;
    if (!raw) return null;
    const ms = new Date(raw).getTime();
    return Number.isFinite(ms) ? ms : null;
  })();
  const [examOver, setExamOver] = useState(
    () => accessUntilMs != null && Date.now() > accessUntilMs,
  );
  /** Server "tugagan" deb javob berdi — soat farqidan qat'i nazar qulflaymiz. */
  const [serverSaysOver, setServerSaysOver] = useState(false);
  const locked = examOver || serverSaysOver;
  /** Kamera bor, mikrofon ochilmagan — qizil xato emas, ogohlantirish */
  const [mediaHint, setMediaHint] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState(false);
  /** `onComplete` chaqirilganmi — shunda unmount cleanup prewarm qilingan
   *  kamera oqimini YO'Q QILMASLIGI kerak (ExamRoom uni da'vo qiladi). */
  const proceededToExamRef = useRef(false);
  const [showVerifyCelebration, setShowVerifyCelebration] = useState(false);
  const [livenessPassed, setLivenessPassed] = useState(false);
  const [livenessChecking, setLivenessChecking] = useState(false);
  const [livenessRetryKey, setLivenessRetryKey] = useState(0);
  const [livenessFailed, setLivenessFailed] = useState(false);
  /** Passiv piksel-farq tekshiruvi o'tdi — active challenge (tabassum) boshlanadi. */
  const [passiveMotionOk, setPassiveMotionOk] = useState(false);
  const [challengeStep, setChallengeStep] = useState<{
    action: LivenessAction;
    step: number;
    total: number;
  } | null>(null);
  const [challengeStatus, setChallengeStatus] = useState<
    'idle' | 'running' | 'passed' | 'failed'
  >('idle');
  const [challengeRetryKey, setChallengeRetryKey] = useState(0);
  /** Pre-exam yuz pozitsiyasi gate (kameraga yaqin + markaz + to'g'ri qaragan). */
  const [positionStatus, setPositionStatus] = useState<FacePositionStatus>('WAITING');
  /** Tasvir tiniqligi va yorug'ligi. */
  const [imageQuality, setImageQuality] = useState<QualityStatus>('OK');
  /** Internet barqarorligi (imtihon davomida har 15s rasm yuboriladi). */
  const [netStatus, setNetStatus] = useState<NetworkStatus | 'CHECKING'>('CHECKING');
  const [netDetail, setNetDetail] = useState('');
  const [netRetryKey, setNetRetryKey] = useState(0);
  /** Ko'z ochiqligi namunalari — imtihonga bazaviy qiymat sifatida uzatiladi. */
  const eyeSamplesRef = useRef<number[]>([]);
  const [positionOk, setPositionOk] = useState(false);
  /** Boshlash bosilganda ochiladigan qoidalar modali. */
  const [showRulesModal, setShowRulesModal] = useState(false);
  const [modalRulesScrolledEnd, setModalRulesScrolledEnd] = useState(false);
  const modalRulesBoxRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  /** Identity snapshot (JPEG) — faqat verifyIdentity */
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /** Liveness getImageData — alohida canvas (bir canvas da kontekst aralashmasin) */
  const livenessCanvasRef = useRef<HTMLCanvasElement>(null);
  const t = translations[lang];
  // Til faqat xato xabarlari uchun — ref orqali. Kamera effekti dependency'siga `lang`
  // qo'shilsa, til almashtirilganda kamera/getUserMedia qayta ishga tushadi (liveness uziladi).
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);

  // Komponent ExamRoom'ga o'tmasdan unmount bo'lsa (masalan foydalanuvchi
  // "Kirish"ni bosgach sahifadan chiqsa) — prewarm qilingan kamera oqimi
  // fonda ochiq qolib ketmasin. `proceededToExamRef` true bo'lsa — ExamRoom
  // shu oqimni da'vo qilishi kerak, TEGMAYMIZ.
  useEffect(
    () => () => {
      if (!proceededToExamRef.current) discardPrewarmedProctorStream();
    },
    [],
  );

  useEffect(() => {
    if (!showRulesModal) return;
    const el = modalRulesBoxRef.current;
    if (!el) return;
    setModalRulesScrolledEnd(false);
    const measure = () => {
      const end =
        el.scrollHeight <= el.clientHeight + 12 ||
        el.scrollTop + el.clientHeight >= el.scrollHeight - 12;
      if (end) setModalRulesScrolledEnd(true);
    };
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      el.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, [showRulesModal, lang]);

  /**
   * Kamera kadridan piksel yig'indisini hisoblaydi.
   * Ko'z yumish yoki tabassum paytida yuz maydoni o'zgaradi — delta katta bo'ladi.
   */
  const captureFrame = (): number => {
    if (!videoRef.current || !livenessCanvasRef.current) return 0;
    const video = videoRef.current;
    const canvas = livenessCanvasRef.current;
    if (!video.videoWidth || !video.videoHeight) return 0;
    // O'lchamni faqat o'zgartirganda yangilaymiz — har kadrda width/height qayta yazilganda
    // canvas tozalanadi va Chromium willReadFrequently ogohlantirishini beradi.
    if (canvas.width !== LIVENESS_W) canvas.width = LIVENESS_W;
    if (canvas.height !== LIVENESS_H) canvas.height = LIVENESS_H;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return 0;
    // Markaziy yuz zonasini olish
    const sw = video.videoWidth;
    const sh = video.videoHeight * 0.6;
    const sx = 0;
    const sy = 0;
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) {
      // Yorug'lik intensivligi (grayscale)
      sum += (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
    }
    return sum;
  };

  useEffect(() => {
    let stream: MediaStream | null = null;
    const checkDevices = async () => {
      const t = tRef.current; // joriy til (effekt qayta ishga tushmaydi)
      setError('');
      setMediaHint('');
      if (!navigator.mediaDevices?.getUserMedia) {
        setError(t.preExamMediaUnsupported);
        return;
      }
      const host = window.location.hostname;
      const isLocal =
        host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
      // Brauzerlar kamera/mikrofonni oddiy http:// domen uchun bloklaydi (localhost bundan mustasno)
      if (!isLocal && window.location.protocol !== 'https:') {
        setError(t.preExamRequiresHttps);
        return;
      }
      if (!isLocal && !window.isSecureContext) {
        setError(t.preExamRequiresHttps);
        return;
      }

      try {
        const q = navigator.permissions?.query?.bind(navigator.permissions);
        if (q) {
          try {
            const st = await q({ name: 'camera' as PermissionName });
            if (st.state === 'denied') {
              setError(`${t.preExamPermissionDenied}\n\n${t.preExamSiteSettingsHint}`);
              return;
            }
          } catch {
            /* Chromium: ba'zi versiyalarda query qo'llab-quvvatlanmaydi */
          }
        }
      } catch {
        /* ignore */
      }

      const domName = (err: unknown) =>
        err instanceof DOMException ? err.name : err instanceof Error ? err.name : '';

      const attachStream = (s: MediaStream) => {
        stream = s;
        setCameraReady(s.getVideoTracks().length > 0);
        setMicReady(s.getAudioTracks().length > 0);
        if (videoRef.current) {
          videoRef.current.srcObject = s;
        }
      };

      // 1) Avval faqat kamera, keyin mikrofon — Windows/Chrome da bir vaqtda olish ko'pincha yiqiladi.
      try {
        const v = await openPreferredCameraStream(false, true);
        const micOk = await attachDefaultMicrophone(v);
        attachStream(v);
        if (!micOk) setMediaHint(t.preExamMicOnlyFailed);
        return;
      } catch (e0: unknown) {
        const n0 = domName(e0);
        if (n0 === 'NotAllowedError' || n0 === 'PermissionDeniedError') {
          if (e0 instanceof DOMException && e0.message === VIRTUAL_CAMERA_BLOCKED_MESSAGE) {
            setError(t.virtualCameraBlocked);
            return;
          }
          setError(`${t.preExamPermissionDenied}\n\n${t.preExamSiteSettingsHint}`);
          return;
        }
        if (n0 === 'SecurityError') {
          setError(t.preExamRequiresHttps);
          return;
        }
        if (n0 === 'NotFoundError' || n0 === 'DevicesNotFoundError') {
          setError(t.preExamMediaNotFound);
          return;
        }
        if (n0 === 'NotReadableError' || n0 === 'TrackStartError') {
          try {
            const rotated = await openCameraByTryingVideoInputs();
            attachStream(rotated);
            if (rotated.getAudioTracks().length === 0) {
              setMediaHint(t.preExamMicOnlyFailed);
            }
            setError('');
            return;
          } catch {
            /* keyingi getUserMedia yo'llariga o'tamiz */
          }
        }
      }

      try {
        const s = await openPreferredCameraStream(true, true);
        attachStream(s);
        if (s.getAudioTracks().length === 0) setMediaHint(t.preExamMicOnlyFailed);
      } catch (e1: unknown) {
        const n1 = domName(e1);
        if (e1 instanceof DOMException && e1.message === VIRTUAL_CAMERA_BLOCKED_MESSAGE) {
          setError(t.virtualCameraBlocked);
        } else if (n1 === 'NotReadableError' || n1 === 'TrackStartError' || n1 === 'NotAllowedError') {
          let vOnly: MediaStream | null = null;
          try {
            vOnly = await openPreferredCameraStream(false, true);
            const micOk = await attachDefaultMicrophone(vOnly);
            attachStream(vOnly);
            if (!micOk) setMediaHint(t.preExamMicOnlyFailed);
            setError('');
          } catch (innerErr: unknown) {
            if (vOnly) vOnly.getTracks().forEach((tr) => tr.stop());
            const ni = domName(innerErr);
            const ref = ni || n1;
            if (ref === 'NotAllowedError' || ref === 'PermissionDeniedError') {
              if (innerErr instanceof DOMException && innerErr.message === VIRTUAL_CAMERA_BLOCKED_MESSAGE) {
                setError(t.virtualCameraBlocked);
              } else {
                setError(`${t.preExamPermissionDenied}\n\n${t.preExamSiteSettingsHint}`);
              }
            } else if (ref === 'SecurityError') {
              setError(t.preExamRequiresHttps);
            } else if (ref === 'NotFoundError' || ref === 'DevicesNotFoundError') {
              setError(t.preExamMediaNotFound);
            } else {
              try {
                const rotated = await openCameraByTryingVideoInputs();
                attachStream(rotated);
                if (rotated.getAudioTracks().length === 0) {
                  setMediaHint(t.preExamMicOnlyFailed);
                }
                setError('');
              } catch {
                try {
                  const raw = await navigator.mediaDevices.getUserMedia({
                    video: true,
                    audio: false,
                  });
                  const micOk = await attachDefaultMicrophone(raw);
                  attachStream(raw);
                  if (!micOk) setMediaHint(t.preExamMicOnlyFailed);
                  setError('');
                } catch (rawErr: unknown) {
                  setError(formatPreExamMediaAccessFailure(rawErr, lang));
                }
              }
            }
          }
        } else if (n1 === 'SecurityError') {
          setError(t.preExamRequiresHttps);
        } else if (n1 === 'NotFoundError' || n1 === 'DevicesNotFoundError') {
          setError(t.preExamMediaNotFound);
        } else if (n1 === 'NotAllowedError' || n1 === 'PermissionDeniedError') {
          if (e1 instanceof DOMException && e1.message === VIRTUAL_CAMERA_BLOCKED_MESSAGE) {
            setError(t.virtualCameraBlocked);
          } else {
            setError(`${t.preExamPermissionDenied}\n\n${t.preExamSiteSettingsHint}`);
          }
        } else {
          setError(t.preExamCameraError);
        }
      }

      if (!stream) {
        try {
          const rotated = await openCameraByTryingVideoInputs();
          attachStream(rotated);
          if (rotated.getAudioTracks().length === 0) {
            setMediaHint(t.preExamMicOnlyFailed);
          }
          setError('');
        } catch {
          try {
            const raw = await navigator.mediaDevices.getUserMedia({
              video: true,
              audio: false,
            });
            const micOk = await attachDefaultMicrophone(raw);
            attachStream(raw);
            if (!micOk) setMediaHint(t.preExamMicOnlyFailed);
            setError('');
          } catch (finalErr: unknown) {
            setError((prev) =>
              prev && prev.length > 0 ? prev : formatPreExamMediaAccessFailure(finalErr, lang)
            );
          }
        }
      }
    };
    checkDevices();
    return () => {
      if (stream) stream.getTracks().forEach((track) => track.stop());
    };
    // Kamera faqat bir marta ochiladi (mount). Til o'zgarishi kamerani qayta ishga tushirmaydi.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Pre-exam yuz pozitsiyasi gate (MediaPipe): yaqin + markaz + to'g'ri qaragan.
   *  Identity verify'dan OLDIN pozitsiyani ta'minlaymiz. */
  useEffect(() => {
    if (!cameraReady || verified) return;
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;
    const checker = new FacePositionChecker(
      video,
      (status, okSustained) => {
        if (cancelled) return;
        setPositionStatus(status);
        setPositionOk(okSustained);
      },
      (ratio) => {
        if (cancelled) return;
        // DIQQAT: ko'z ko'rinishi imtihonga KIRISHNI BLOKLAMAYDI. Ilgari
        // "Ko'zlar aniqlanmadi" holati darvoza edi va talaba imtihonga umuman
        // kira olmay qolardi (signal bir kadr uchun yo'qolsa ham) — shu sabab
        // tekshiruv olib tashlandi.
        //
        // Namuna yig'ish esa QOLADI: talabaning TABIIY ko'z ochiqligi.
        // Imtihonda "ko'z toraydi" (pastga qarash) shu bazaviy qiymatga
        // NISBATAN aniqlanadi — mutlaq chegara odamlar orasida ishlamaydi.
        // Yetarli namuna bo'lmasa baseline saqlanmaydi va nigoh nazorati
        // mutlaq chegaraga qaytadi (`eyeBaselineFrom` null qaytaradi).
        if (typeof ratio === 'number' && ratio > 0) {
          const arr = eyeSamplesRef.current;
          arr.push(ratio);
          if (arr.length > 60) arr.shift();
        }
      },
    );
    void checker.init().then((ok) => {
      if (cancelled) {
        checker.dispose();
        return;
      }
      if (ok) {
        checker.start();
      } else {
        // Model yuklanmadi (CDN bloklangan / eski qurilma) — gate skip, imtihon bloklanmasin.
        setPositionStatus('OK');
        setPositionOk(true);
      }
    });
    return () => {
      cancelled = true;
      checker.dispose();
    };
  }, [cameraReady, verified]);

  /** Shaxs tasdiqlandi — tugmasiz: kamera kadrlarida yengil harakat qidiriladi
   *  (statik foto/video-replay'ga qarshi arzon birinchi qatlam). O'tsa, active
   *  bosh-burish challenge boshlanadi (keyingi effekt). */
  useEffect(() => {
    if (!verified || passiveMotionOk || !cameraReady) return;

    let cancelled = false;
    const run = async () => {
      setLivenessChecking(true);
      setLivenessFailed(false);
      setIdentityError('');
      await new Promise((r) => setTimeout(r, 450));
      for (let round = 0; round < 3; round++) {
        if (cancelled) return;
        const ok = await samplePassiveFrameMotion(() => captureFrame());
        if (ok) {
          if (!cancelled) {
            setPassiveMotionOk(true);
            setLivenessChecking(false);
            setLivenessFailed(false);
            setIdentityError('');
          }
          return;
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      if (!cancelled) {
        setLivenessChecking(false);
        setLivenessFailed(true);
        setIdentityError(tRef.current.preExamLivenessFail);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verified, cameraReady, passiveMotionOk, livenessRetryKey]);

  /**
   * Tasvir sifati — tiniqlik va yorug'lik. Nigoh nazorati qorachiqni o'qishga
   * tayanadi: xira yoki qorong'i kadrda u ishlamaydi va talaba pastga qarab
   * telefondan javob ko'rishi mumkin. Shu sabab imtihon oldidan tekshiriladi.
   */
  useEffect(() => {
    if (!cameraReady) return;
    const id = window.setInterval(() => {
      const video = videoRef.current;
      const canvas = livenessCanvasRef.current;
      if (!video || !canvas || !video.videoWidth) return;
      if (canvas.width !== LIVENESS_W) canvas.width = LIVENESS_W;
      if (canvas.height !== LIVENESS_H) canvas.height = LIVENESS_H;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, LIVENESS_W, LIVENESS_H);
      const gray = grayscaleFromCanvas(ctx, LIVENESS_W, LIVENESS_H);
      if (!gray) return;
      setImageQuality(classifyImageQuality(computeImageStats(gray, LIVENESS_W, LIVENESS_H)));
    }, 1200);
    return () => clearInterval(id);
  }, [cameraReady]);

  /**
   * Internet barqarorligi. Imtihon davomida har 15s shaxs tekshiruvi va har 15s
   * kadr tahlili rasm yuboradi — beqaror ulanishda nazorat uzilib qoladi.
   * Shuning uchun boshlashdan oldin bir necha o'lchov olinadi.
   */
  useEffect(() => {
    let cancelled = false;
    setNetStatus('CHECKING');
    setNetDetail('');
    (async () => {
      const samples: { ms: number | null }[] = [];
      for (let i = 0; i < 6 && !cancelled; i += 1) {
        const t0 = performance.now();
        try {
          const res = await fetch(apiUrl(`/api/health?probe=${Date.now()}-${i}`), {
            cache: 'no-store',
          });
          samples.push({ ms: res.ok ? Math.round(performance.now() - t0) : null });
        } catch {
          samples.push({ ms: null });
        }
        if (!cancelled && i < 5) await new Promise((r) => setTimeout(r, 250));
      }
      if (cancelled) return;
      const stats = classifyNetwork(samples);
      setNetStatus(stats.status);
      setNetDetail(
        stats.status === 'OK'
          ? `${stats.medianMs} ms`
          : `${stats.medianMs} ms · ±${stats.jitterMs} ms · ${stats.failures}/${stats.samples}`,
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [netRetryKey]);

  /**
   * Passiv tekshiruvdan keyin — FAOL chaqiriq: TASODIFIY harakatlar ketma-ketligi.
   *
   * Ilgari har doim bitta xil harakat ("tabassum qiling") so'ralardi, shu sabab
   * bir marta yozib olingan video uni cheksiz o'tardi. Endi har urinishda
   * harakatlar tasodifiy tanlanadi va har biri SO'RALGANDAN KEYIN boshlanishi
   * shart (mantiq `lib/livenessChallenge.ts` da, testlar bilan qoplangan).
   */
  useEffect(() => {
    if (!verified || !passiveMotionOk || livenessPassed || !cameraReady) return;
    const video = videoRef.current;
    if (!video) return;

    let cancelled = false;
    // Faqat TABASSUM so'raladi — talaba uchun eng sodda va tushunarli harakat.
    // (Modul ko'z qisish / og'iz ochish / bosh burishni ham qo'llab-quvvatlaydi
    //  — kerak bo'lsa shu ro'yxatga qo'shish yoki `pickLivenessActions()` ga
    //  qaytarish kifoya.)
    const actions: LivenessAction[] = ['SMILE'];
    setChallengeStep({ action: actions[0], step: 1, total: actions.length });
    setChallengeStatus('running');

    const tracker = new LivenessChallengeTracker(
      video,
      actions,
      {
        onProgress: (info) => {
          if (cancelled) return;
          setChallengeStep({ action: info.action, step: info.step, total: info.total });
        },
        onPassed: () => {
          if (!cancelled) setChallengeStatus('passed');
        },
        // DOIMIY tekshiruv — timeout Infinity, shu sabab onFailed hech qachon
        // chaqirilmaydi. Talaba tayyor bo'lganda jilmayadi, "qayta urinish"
        // tugmasi ko'rsatilmaydi.
        onFailed: () => {},
      },
      Infinity,
    );

    void tracker.init().then((ok) => {
      if (cancelled) {
        tracker.dispose();
        return;
      }
      if (ok) {
        tracker.start();
      } else {
        // Model yuklanmadi — chaqiriq o'tkazib yuboriladi (imtihon bloklanmasin);
        // passiv tekshiruv va serverdagi shaxs tasdiqlash allaqachon o'tgan.
        setChallengeStatus('passed');
      }
    });

    return () => {
      cancelled = true;
      tracker.dispose();
    };
  }, [verified, passiveMotionOk, livenessPassed, cameraReady, challengeRetryKey]);

  useEffect(() => {
    if (challengeStatus === 'passed') setLivenessPassed(true);
  }, [challengeStatus]);

  useEffect(() => {
    if (!verified) {
      setShowVerifyCelebration(false);
      return;
    }
    setShowVerifyCelebration(true);
    const timer = window.setTimeout(() => setShowVerifyCelebration(false), 2800);
    return () => window.clearTimeout(timer);
  }, [verified]);

  const verifyIdentity = async () => {
    if (!videoRef.current || !canvasRef.current || !user.profile_image) return;
    setVerifying(true);
    setIdentityError('');
    setError('');
    try {
      const video = videoRef.current;
      const liveDataUrl = compressVideoFrameToJpeg(video, 0.78, 480, true);
      if (!liveDataUrl) return;
      const capturedImageBase64 = liveDataUrl.split(',')[1];
      const profilePayload = String(user.profile_image).includes(',')
        ? user.profile_image
        : `data:image/jpeg;base64,${user.profile_image}`;

      const response = await fetch(apiUrl('/api/student/identity-compare'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...examAuthHeaders(token),
        },
        body: JSON.stringify({
          exam_id: exam.id,
          profile_image_base64: profilePayload,
          live_capture_base64: capturedImageBase64,
        }),
      });
      const data =
        (await readJsonSafe<{
          match?: boolean;
          skipped?: boolean;
          code?: string;
          error?: string;
          score?: number;
          method?: string;
        }>(response)) || {};
      if (response.status === 503) {
        const code = data?.code || '';
        setIdentityError(
          code === 'GEMINI_UNAVAILABLE' || code === 'FACE_ENGINE_UNAVAILABLE'
            ? t.identityVerifyServiceDown
            : code === 'GEMINI_MODEL_INVALID'
              ? t.identityVerifyGeminiModelInvalid
              : code === 'GEMINI_ERROR'
                ? t.identityVerifyGeminiError
                : t.identityVerifyError
        );
        return;
      }
      if (response.status === 403) {
        const code = data?.code || '';
        const sessionLocked =
          code === 'DEVICE_MISMATCH' ||
          code === 'DEVICE_TOKEN_REQUIRED' ||
          code === 'DEVICE_FINGERPRINT_REQUIRED' ||
          code === 'VAC_HMAC_SESSION_MISSING' ||
          code.startsWith('VAC_');
        setIdentityError(
          code === 'STUDENT_ONLY'
            ? t.identityVerify403StudentOnly
            : code === 'EXAM_NOT_ASSIGNED'
              ? t.identityVerify403ExamNotAssigned
              : sessionLocked
                ? t.identityVerify403SessionLocked
                : t.identityVerifyError,
        );
        return;
      }
      if (!response.ok) {
        setIdentityError(t.identityVerifyError);
        return;
      }
      if (data.match === true) {
        setVerified(true);
        setIdentityError('');
      } else {
        const code = data?.code || '';
        setIdentityError(
          code === 'FACE_NOT_DETECTED' ? t.identityVerifyFaceNotDetected : t.identityVerifyFailed,
        );
      }
    } catch {
      setIdentityError(t.identityVerifyError);
    } finally {
      setVerifying(false);
    }
  };

  const handleEnter = async () => {
    setError('');
    setStarting(true);
    // ExamRoom kamera/mikrofonni ochishini KUTMASDAN, tarmoq so'rovi bilan
    // PARALLEL boshlab qo'yamiz — "Kamera tayyorlanmoqda" ekrani deyarli
    // darhol o'tishi uchun (bewaqt xato bo'lsa ExamRoom o'zi qayta so'raydi).
    prewarmProctorStream();
    try {
      const res = await fetch(apiUrl(`/api/student/exams/${exam.id}/start`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Student-Lang': lang,
          ...examAuthHeaders(token),
        },
        body: JSON.stringify({ student_lang: lang }),
      });
      const data = await readJsonSafe<{
        error?: string;
        code?: string;
        exam?: any;
        studentExamId?: number;
        startedAt?: string;
        sessionKey?: string;
        sessionSeqStart?: number;
        sessionChallenge?: string;
        deviceToken?: string;
      }>(res);
      if (!res.ok || !data?.exam || data.studentExamId == null) {
        setError(data?.error || t.preExamStartError);
        discardPrewarmedProctorStream();
        // 403 — imtihon oynasi yopilgan (tugagan yoki hali boshlanmagan).
        // Sahifani qulflaymiz: qayta-qayta urinish faqat server va AI'ni
        // bekorga yuklaydi, natija o'zgarmaydi.
        if (res.status === 403) {
          setServerSaysOver(true);
          setShowRulesModal(false);
        }
        return;
      }
      if (data.deviceToken) {
        setDeviceSessionToken(data.deviceToken);
      }
      // Ko'z ochiqligi bazaviy qiymati — imtihonda nigoh nazorati SHUNGA
      // nisbatan ishlaydi. Yetarli namuna yo'q bo'lsa saqlanmaydi va imtihon
      // mutlaq chegaraga qaytadi (soxta ogohlantirishdan xavfsizroq).
      const eyeBaseline = eyeBaselineFrom(eyeSamplesRef.current);
      try {
        if (eyeBaseline) {
          sessionStorage.setItem(`exam_eye_baseline_${exam?.id}`, String(eyeBaseline));
        } else {
          sessionStorage.removeItem(`exam_eye_baseline_${exam?.id}`);
        }
      } catch {
        /* sessionStorage o'chirilgan — nisbiy taqqoslash ishlamaydi, xato emas */
      }
      proceededToExamRef.current = true;
      onComplete(
        {
          ...data.exam,
          startedAt: data.startedAt,
          sessionKey: data.sessionKey,
          sessionSeqStart: data.sessionSeqStart,
          sessionChallenge: data.sessionChallenge,
        },
        data.studentExamId,
      );
    } catch {
      setError(t.preExamNetworkError);
      discardPrewarmedProctorStream();
    } finally {
      setStarting(false);
    }
  };

  // Muddat sahifada turganda ham o'tib ketishi mumkin — kuzatib boramiz.
  useEffect(() => {
    if (accessUntilMs == null || examOver) return;
    const tick = () => {
      if (Date.now() > accessUntilMs) setExamOver(true);
    };
    tick();
    const id = window.setInterval(tick, 5_000);
    return () => window.clearInterval(id);
  }, [accessUntilMs, examOver]);

  // Qulflangach kamera/mikrofonni DARHOL bo'shatamiz — imtihon tugagan bo'lsa
  // talabani kuzatib turishning ma'nosi yo'q va qurilma band qolmasin.
  useEffect(() => {
    if (!locked) return;
    const v = videoRef.current;
    const stream = v?.srcObject as MediaStream | null;
    stream?.getTracks().forEach((t) => t.stop());
    if (v) v.srcObject = null;
    setCameraReady(false);
  }, [locked]);

  async function openRulesModal() {
    setError('');
    setModalRulesScrolledEnd(false);
    setShowRulesModal(true);
  }

  const vacRulesList = (
    <>
      <p className="text-[12.5px] text-gray-500">{t.preExamVacRulesIntroModal}</p>
      {t.preExamVacRulesItems.split('|||RULE|||').map((line, i) => (
        <div key={i} className="flex gap-2.5">
          <span className="shrink-0 flex items-center justify-center w-5 h-5 rounded-md bg-indigo-50 text-indigo-600 font-bold text-[11px] tabular-nums mt-0.5">
            {i + 1}
          </span>
          <p className="min-w-0 flex-1">{line.trim()}</p>
        </div>
      ))}
    </>
  );

  const positionLabel = (
    {
      WAITING: t.preExamPositionWaiting,
      NO_FACE: t.preExamPositionNoFace,
      MULTIPLE_FACES: t.preExamPositionMulti,
      TOO_FAR: t.preExamPositionTooFar,
      TOO_CLOSE: t.preExamPositionTooClose,
      OFF_CENTER: t.preExamPositionOffCenter,
      TURNED: t.preExamPositionTurned,
      OK: t.preExamPositionOk,
    } as Record<FacePositionStatus, string>
  )[positionStatus];

  // Progress qadamlari — qoidalar oxirgi "Boshlash" modali orqali tasdiqlanadi.
  const steps = [
    { label: PRE_L[lang].stepCamera, done: cameraReady },
    { label: PRE_L[lang].stepIdentity, done: verified },
    { label: PRE_L[lang].stepLiveness, done: livenessPassed },
  ];
  const activeStepIdx = steps.findIndex((s) => !s.done);

  const blocked: string[] = [];
  if (!cameraReady) blocked.push(t.preExamBlockedCamera);
  if (!micReady) blocked.push(t.preExamBlockedMic);
  if (!user.profile_image) blocked.push(t.preExamBlockedPhoto);
  if (!verified) blocked.push(t.preExamBlockedIdentity);
  if (!livenessPassed || livenessChecking) blocked.push(t.preExamBlockedLiveness);
  if (imageQuality !== 'OK') blocked.push(t.preExamBlockedQuality);
  if (netStatus !== 'OK') blocked.push(t.preExamBlockedNetwork);
  const canStart = blocked.length === 0 && !locked;

  const studentDisplayName = (user.name || user.id || '').toString().trim();
  const nameParts = studentDisplayName.split(/\s+/).filter(Boolean);
  const studentFirstName = nameParts[0] || studentDisplayName;
  const studentLastName = nameParts.slice(1).join(' ');

  // Imtihon yopilgan — tekshiruv sahifasini KO'RSATMAYMIZ. Ilgari sahifa to'liq
  // ochiq qolar, kamera ishlab turar, "Kirish" bosilaverar va har urinishda
  // shaxs tasdiqlash (server + AI) bekorga sarflanardi.
  if (locked) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full min-h-[60dvh] flex items-center justify-center p-4"
      >
        <div className="w-full max-w-lg rounded-2xl border border-gray-200 bg-white shadow-sm p-6 sm:p-8 text-center space-y-4">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-red-100 text-red-600">
            <svg className="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <h2 className="text-xl sm:text-2xl font-bold text-gray-900">{t.preExamClosedTitle}</h2>
            <p className="mt-2 text-sm text-gray-500 leading-relaxed">{t.preExamClosedBody}</p>
          </div>
          {error && <AdminAlert type="error" compact>{error}</AdminAlert>}
          <AdminBtn variant="blue" size="lg" className="w-full" onClick={onCancel}>
            {t.cancel}
          </AdminBtn>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="w-full h-[calc(100dvh-62px)] sm:h-[calc(100dvh-66px)] flex flex-col bg-gray-50 overflow-hidden"
    >
      <div className="w-full max-w-6xl mx-auto px-3 sm:px-6 py-3 sm:py-4 flex flex-col gap-3 flex-1 min-h-0">
        {/* ── Sub-header: title + stepper ── */}
        <div className="shrink-0 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div className="min-w-0 space-y-2">
            <h1 className="text-[19px] sm:text-[22px] font-bold text-gray-900 tracking-tight leading-tight">
              {t.preExamTitle}
            </h1>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 max-w-full rounded-lg border border-indigo-100 bg-indigo-50 px-2.5 py-1 text-[12px] font-semibold text-indigo-800">
                <svg className="h-3.5 w-3.5 shrink-0 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <span className="truncate">{exam.title}</span>
              </span>
              {user.group_name && (
                <span className="inline-flex items-center gap-1.5 max-w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-[12px] font-medium text-gray-600">
                  <svg className="h-3.5 w-3.5 shrink-0 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <span className="truncate">{user.group_name}</span>
                </span>
              )}
              <span className="inline-flex items-center gap-1.5 max-w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-[12px] font-medium text-gray-700">
                <svg className="h-3.5 w-3.5 shrink-0 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                <span className="truncate">
                  <span className="font-semibold text-gray-900">{studentFirstName}</span>
                  {studentLastName ? <span className="text-gray-500"> {studentLastName}</span> : null}
                </span>
              </span>
            </div>
          </div>
          {/* Stepper */}
          <div className="flex items-center gap-1.5 sm:gap-2 overflow-x-auto">
            {steps.map((s, i) => {
              const isActive = i === activeStepIdx;
              return (
                <React.Fragment key={s.label}>
                  {i > 0 && <span className={`h-px w-4 sm:w-6 shrink-0 ${steps[i - 1].done ? 'bg-emerald-300' : 'bg-gray-200'}`} />}
                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-bold transition-colors ${
                        s.done
                          ? 'bg-emerald-500 text-white'
                          : isActive
                            ? 'bg-indigo-600 text-white'
                            : 'bg-gray-200 text-gray-500'
                      }`}
                    >
                      {s.done ? <Check className="w-3.5 h-3.5 stroke-[3]" /> : i + 1}
                    </span>
                    <span className={`text-[12px] font-semibold whitespace-nowrap ${isActive ? 'inline' : 'hidden sm:inline'} ${s.done ? 'text-emerald-700' : isActive ? 'text-gray-900' : 'text-gray-400'}`}>
                      {s.label}
                    </span>
                  </div>
                </React.Fragment>
              );
            })}
          </div>
        </div>

        {(error || mediaHint) && (
          <div className="shrink-0 space-y-2 max-h-[min(28dvh,140px)] overflow-y-auto overscroll-y-contain">
            {error && <AdminAlert type="error" compact>{error}</AdminAlert>}
            {mediaHint && !error && <AdminAlert type="warning" compact>{mediaHint}</AdminAlert>}
          </div>
        )}

        {/* ── Body (mobilda scroll, desktopda ikki ustun — ortada bo'sh joy qoldirmaydi) ── */}
        <div className="flex-1 min-h-0 flex flex-col gap-3 overflow-y-auto overscroll-y-contain">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5 items-start">
          {/* Kamera (chap ustun) — logo olib tashlandi. Shaxs/jonlik tekshiruvi
              endi ALOHIDA (o'ng) ustunda — ikkalasi ham video ostiga siqilib,
              qisqargan joy ichida qolib ketmasin (jonlik qismi ko'rinmay qolardi). */}
          <div className="flex flex-col gap-3">
            <div className="shrink-0">
              <div className="relative w-full rounded-xl overflow-hidden border border-gray-300 bg-slate-900 aspect-video">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                  style={{ transform: 'scaleX(-1)', filter: 'brightness(1.12) contrast(1.08) saturate(1.03)' }}
                />
                <canvas ref={canvasRef} className="hidden" aria-hidden />
                <canvas ref={livenessCanvasRef} className="hidden" aria-hidden />
                {!cameraReady && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-gray-400 text-xs bg-slate-800 px-2 text-center">
                    <svg className="w-8 h-8 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                    {t.preExamWaitCamera}
                  </div>
                )}
                {showVerifyCelebration && (
                  <IdentityVerifiedSuccess
                    title={t.identityVerifySuccessTitle}
                    subtitle={t.identityVerifySuccessSubtitle}
                  />
                )}
                <div className="absolute top-2 left-2 flex items-center gap-1.5 bg-black/55 backdrop-blur-sm rounded-full px-2 py-1">
                  <span className={`w-1.5 h-1.5 rounded-full ${cameraReady ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`} />
                  <span className="text-white text-[10.5px] font-medium">{cameraReady ? t.preExamCameraActive : t.preExamWaitCamera}</span>
                </div>
                <div className="absolute top-2 right-2 flex items-center gap-1.5 bg-black/55 backdrop-blur-sm rounded-full px-2 py-1">
                  <span className={`w-1.5 h-1.5 rounded-full ${micReady ? 'bg-emerald-400' : 'bg-red-400'}`} />
                  <span className="text-white text-[10.5px] font-medium">{micReady ? t.preExamMicActive : t.preExamMicInactive}</span>
                </div>
              </div>
            </div>

            {exam.custom_rules && (
              <div className="p-3 border border-gray-200 bg-gray-50 rounded-lg text-[12.5px] text-gray-600">
                <span className="font-semibold text-gray-900">{t.customRules}: </span>
                {exam.custom_rules}
              </div>
            )}
          </div>

          {/* Shaxs va jonlilik tekshiruvi — o'z ustuni. */}
          <section className="flex flex-col gap-3">
            {user.profile_image ? (
              <div className={`flex flex-col min-h-0 p-4 border rounded-xl space-y-3 transition-colors ${verified ? 'border-emerald-200 bg-emerald-50/40' : 'border-gray-200 bg-white'}`}>
                <div className="flex items-center gap-3 shrink-0">
                  <div className="relative shrink-0">
                    <img
                      src={user.profile_image}
                      alt={t.profilePhotoLabel}
                      className="w-11 h-11 rounded-lg object-cover ring-1 ring-gray-200"
                      referrerPolicy="no-referrer"
                    />
                    {verified && (
                      <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white ring-2 ring-white">
                        <Check className="h-3 w-3 stroke-[3]" aria-hidden />
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h4 className="font-semibold text-gray-900 text-[14px] leading-tight">{t.identityVerification}</h4>
                    <p className="text-[12px] text-gray-500 truncate mt-0.5">{user.name || user.id}</p>
                  </div>
                </div>

                {identityError && (
                  <AdminAlert type="error" compact>
                    {identityError}
                  </AdminAlert>
                )}

                {!verified && !isRetakeResolved && (
                  <div className={`shrink-0 rounded-lg px-3 py-2 border flex items-center gap-2 transition-colors ${positionOk ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
                    <span className={`inline-block h-2 w-2 rounded-full shrink-0 ${positionOk ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse'}`} />
                    <p className={`text-[12.5px] font-medium leading-snug ${positionOk ? 'text-emerald-700' : 'text-amber-700'}`}>{positionLabel}</p>
                  </div>
                )}

                <AdminBtn
                  onClick={verifyIdentity}
                  disabled={!cameraReady || verifying || verified || (!positionOk && !isRetakeResolved)}
                  variant={verified ? 'emerald' : 'blue'}
                  size="md"
                  loading={verifying}
                  className="w-full shrink-0"
                >
                  {verified ? t.identityVerified : t.identityVerifyBtn}
                </AdminBtn>

                {(verified || livenessChecking || livenessPassed || livenessFailed || challengeStatus !== 'idle') && (
                  <div className="min-h-0 max-h-[min(40dvh,320px)] overflow-y-auto overscroll-y-contain text-[12.5px] text-gray-600 pr-0.5">
                    {verified && !passiveMotionOk && !livenessChecking && !livenessFailed && (
                      <p>{t.preExamLivenessSelfHint}</p>
                    )}
                    {livenessChecking && (
                      <p className="text-indigo-700 flex items-center gap-1.5">
                        <span className="inline-block h-1.5 w-1.5 rounded-full bg-indigo-500 animate-pulse" />
                        {t.preExamLivenessWaiting}
                      </p>
                    )}
                    {!livenessPassed && livenessFailed && !livenessChecking && (
                      <AdminBtn
                        variant="ghost"
                        size="sm"
                        className="w-full mt-1"
                        onClick={() => {
                          setLivenessFailed(false);
                          setIdentityError('');
                          setLivenessRetryKey((k) => k + 1);
                        }}
                      >
                        {t.preExamLivenessRetryBtn}
                      </AdminBtn>
                    )}
                    {challengeStatus === 'running' && challengeStep && (
                      <div className="space-y-1">
                        <p className="font-semibold text-indigo-700 flex items-center gap-1.5">
                          <span className="inline-block h-1.5 w-1.5 rounded-full bg-indigo-500 animate-pulse" />
                          {LIVENESS_PROMPT_KEY[challengeStep.action]
                            ? t[LIVENESS_PROMPT_KEY[challengeStep.action]]
                            : ''}
                        </p>
                        {challengeStep.total > 1 && (
                          <p className="text-[11px] text-slate-400 tabular-nums">
                            {t.preExamChallengeProgress
                              .replace('{cur}', String(challengeStep.step))
                              .replace('{total}', String(challengeStep.total))}
                          </p>
                        )}
                      </div>
                    )}
                    {challengeStatus === 'failed' && (
                      <AdminBtn
                        variant="ghost"
                        size="sm"
                        className="w-full mt-1"
                        onClick={() => {
                          setChallengeStatus('idle');
                          setIdentityError('');
                          setChallengeRetryKey((k) => k + 1);
                        }}
                      >
                        {t.preExamChallengeRetryBtn}
                      </AdminBtn>
                    )}
                    {livenessPassed && (
                      <p className="font-semibold text-emerald-700 flex items-center gap-1.5">
                        <Check className="w-4 h-4 stroke-[3]" /> {t.preExamLivenessPassed}
                      </p>
                    )}
                  </div>
                )}

                {/* ── Nazorat sifati: ko'z / tasvir / internet ──
                    Nigoh nazorati qorachiqni o'qishga tayanadi, shaxs tekshiruvi
                    va kadr tahlili esa har 15s rasm yuboradi. Ikkisi ham imtihon
                    boshlangandan keyin tuzatilmaydi — shu sabab shart. */}
                <div className="mt-3 pt-3 border-t border-gray-100 space-y-2 text-[12.5px]">
                  {[
                    {
                      title: t.preExamQualityTitle,
                      ok: imageQuality === 'OK',
                      msg: {
                        OK: t.preExamQualityOk,
                        BLURRY: t.preExamQualityBlurry,
                        TOO_DARK: t.preExamQualityDark,
                        TOO_BRIGHT: t.preExamQualityBright,
                        LOW_CONTRAST: t.preExamQualityLowContrast,
                      }[imageQuality],
                      extra: '',
                    },
                    {
                      title: t.preExamNetworkTitle,
                      ok: netStatus === 'OK',
                      msg: {
                        CHECKING: t.preExamNetworkChecking,
                        OK: t.preExamNetworkOk,
                        SLOW: t.preExamNetworkSlow,
                        UNSTABLE: t.preExamNetworkUnstable,
                        OFFLINE: t.preExamNetworkOffline,
                      }[netStatus],
                      extra: netDetail,
                    },
                  ].map((row) => (
                    <div key={row.title} className="flex items-start gap-2">
                      <span
                        className={`mt-[3px] h-2 w-2 shrink-0 rounded-full ${
                          row.ok ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse'
                        }`}
                      />
                      <span className="min-w-0">
                        <span className="text-gray-400">{row.title}: </span>
                        <span className={row.ok ? 'text-emerald-700 font-medium' : 'text-amber-800'}>
                          {row.msg}
                        </span>
                        {row.extra ? <span className="text-gray-400"> · {row.extra}</span> : null}
                      </span>
                    </div>
                  ))}
                  {netStatus !== 'OK' && netStatus !== 'CHECKING' && (
                    <AdminBtn
                      variant="ghost"
                      size="sm"
                      className="w-full mt-1"
                      onClick={() => setNetRetryKey((k) => k + 1)}
                    >
                      {t.preExamNetworkRetryBtn}
                    </AdminBtn>
                  )}
                </div>
              </div>
            ) : (
              <div className="p-3 border border-red-200 bg-red-50 rounded-lg text-red-700 text-[12.5px] font-medium">
                {t.profilePhotoMissingExam}
              </div>
            )}
          </section>
            </div>

        {/* ── Footer action bar (kontent ostida, ortada bo'sh joy yo'q) ── */}
        <div className="shrink-0 rounded-xl border border-gray-200 bg-white p-4 sm:p-5 space-y-3 shadow-[0_-4px_24px_rgba(15,23,42,0.06)]">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-end gap-3">
            <div className="flex gap-2 w-full sm:w-auto shrink-0">
              <AdminBtn variant="ghost" size="lg" onClick={onCancel} className="flex-1 sm:flex-none">
                {t.cancel}
              </AdminBtn>
              <AdminBtn
                variant="blue"
                size="lg"
                onClick={() => void openRulesModal()}
                disabled={!canStart || starting}
                loading={starting && showRulesModal}
                className="flex-1 sm:flex-none sm:px-8"
              >
                {starting && showRulesModal ? t.preExamStarting : t.preExamEnterExam}
              </AdminBtn>
            </div>
          </div>

          {!canStart && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-1 text-[11.5px] text-gray-500">
              <span className="font-semibold text-gray-600">{t.preExamStartChecklist}</span>
              {blocked.map((b) => (
                <span key={b} className="inline-flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                  {b}
                </span>
              ))}
            </div>
          )}
        </div>
        </div>
      </div>

      {showRulesModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pre-exam-rules-modal-title"
        >
          <div className="flex w-full max-w-lg max-h-[min(88dvh,640px)] flex-col rounded-2xl border border-gray-200 bg-white shadow-xl overflow-hidden">
            <header className="shrink-0 px-5 py-4 border-b border-gray-100">
              <h2 id="pre-exam-rules-modal-title" className="font-display text-lg text-gray-900">
                {t.preExamVacRulesTitle}
              </h2>
              <p className="mt-1 text-[12.5px] text-gray-500">{t.preExamRulesModalHint}</p>
            </header>
            <div
              ref={modalRulesBoxRef}
              data-testid="vac-rules-modal-box"
              className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain px-5 py-4 text-[13px] text-gray-700 leading-relaxed space-y-3"
            >
              {vacRulesList}
            </div>
            {!modalRulesScrolledEnd && (
              <p className="shrink-0 px-5 py-2 text-center text-[11px] font-medium text-gray-500 bg-gray-50 border-t border-gray-100">
                ↓ {t.preExamVacRulesScrollHint}
              </p>
            )}
            <div className="shrink-0 flex gap-2 border-t border-gray-100 p-4">
              <AdminBtn
                variant="ghost"
                size="lg"
                className="flex-1"
                disabled={starting}
                onClick={() => setShowRulesModal(false)}
              >
                {t.cancel}
              </AdminBtn>
              <AdminBtn
                variant="blue"
                size="lg"
                className="flex-1"
                disabled={!modalRulesScrolledEnd || starting}
                loading={starting}
                onClick={() => void handleEnter()}
              >
                {starting ? t.preExamStarting : t.preExamRulesModalConfirm}
              </AdminBtn>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}
