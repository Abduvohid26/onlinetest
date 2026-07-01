import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { Card, CardContent } from '../components/ui';
import { motion } from 'motion/react';
import { translations, Language, formatPreExamMediaAccessFailure } from '../i18n';
import { readJsonSafe } from '../lib/http';
import { apiUrl } from '../lib/apiUrl';
import { examAuthHeaders, setDeviceSessionToken } from '../lib/deviceFingerprint';
import { compressVideoFrameToJpeg } from '../lib/compressToJpeg';
import { FacePositionChecker, type FacePositionStatus } from '../lib/facePositionCheck';
import { InstituteLogo } from '../components/InstituteLogo';
import { IdentityVerifiedSuccess } from '../components/IdentityVerifiedSuccess';
import { AdminBtn, AdminAlert, AdminInput } from './admin/ui';
import { Check } from 'lucide-react';
import {
  attachDefaultMicrophone,
  openCameraByTryingVideoInputs,
  openPreferredCameraStream,
  VIRTUAL_CAMERA_BLOCKED_MESSAGE,
} from '../lib/preferredCameraStream';

const PASSIVE_LIVE_SAMPLES = 12;
const PASSIVE_LIVE_GAP_MS = 260;
const PASSIVE_LIVE_THRESHOLD = 400;
const LIVENESS_W = 80;
const LIVENESS_H = 60;

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
  onComplete,
  onCancel,
}: {
  exam: any;
  token: string;
  user: any;
  lang: Language;
  onComplete: (examData: any, seId: number) => void;
  onCancel: () => void;
}) {
  const [cameraReady, setCameraReady] = useState(false);
  const [micReady, setMicReady] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  /** Kamera bor, mikrofon ochilmagan — qizil xato emas, ogohlantirish */
  const [mediaHint, setMediaHint] = useState('');
  const [starting, setStarting] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState(false);
  const [verifyScore, setVerifyScore] = useState<number | null>(null);
  const [showVerifyCelebration, setShowVerifyCelebration] = useState(false);
  const [livenessPassed, setLivenessPassed] = useState(false);
  const [livenessChecking, setLivenessChecking] = useState(false);
  const [livenessRetryKey, setLivenessRetryKey] = useState(0);
  const [livenessFailed, setLivenessFailed] = useState(false);
  /** Pre-exam yuz pozitsiyasi gate (kameraga yaqin + markaz + to'g'ri qaragan). */
  const [positionStatus, setPositionStatus] = useState<FacePositionStatus>('WAITING');
  const [positionOk, setPositionOk] = useState(false);
  /** VAC qoidalari ro'yxati oxirigacha aylantirilgani (katta ekranda ham majburiy). */
  const [vacRulesScrolledEnd, setVacRulesScrolledEnd] = useState(false);
  const vacRulesBoxRef = useRef<HTMLDivElement>(null);
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

  useLayoutEffect(() => {
    setVacRulesScrolledEnd(false);
    setAgreed(false);
  }, [lang]);

  useEffect(() => {
    const el = vacRulesBoxRef.current;
    if (!el) return;
    const measure = () => {
      const end =
        el.scrollHeight <= el.clientHeight + 12 ||
        el.scrollTop + el.clientHeight >= el.scrollHeight - 12;
      setVacRulesScrolledEnd(end);
    };
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      el.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, [lang]);

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
    const checker = new FacePositionChecker(video, (status, okSustained) => {
      if (cancelled) return;
      setPositionStatus(status);
      setPositionOk(okSustained);
    });
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

  /** Shaxs tasdiqlandi — tugmasiz: kamera kadrlarida yengil harakat qidiriladi */
  useEffect(() => {
    if (!verified || livenessPassed || !cameraReady) return;

    let cancelled = false;
    const run = async () => {
      setLivenessChecking(true);
      setLivenessFailed(false);
      setError('');
      await new Promise((r) => setTimeout(r, 450));
      for (let round = 0; round < 3; round++) {
        if (cancelled) return;
        const ok = await samplePassiveFrameMotion(() => captureFrame());
        if (ok) {
          if (!cancelled) {
            setLivenessPassed(true);
            setLivenessChecking(false);
            setLivenessFailed(false);
            setError('');
          }
          return;
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      if (!cancelled) {
        setLivenessChecking(false);
        setLivenessFailed(true);
        setError(tRef.current.preExamLivenessFail);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verified, cameraReady, livenessPassed, livenessRetryKey]);

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
        setError(
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
        setError(
          code === 'STUDENT_ONLY'
            ? 'Yuz tekshiruvi faqat talaba hisobi uchun. Talaba ID bilan kiring.'
            : code === 'EXAM_NOT_ASSIGNED'
              ? 'Siz ushbu imtihon guruhiga biriktirilmagansiz. Administrator bilan bog‘laning.'
              : code === 'DEVICE_MISMATCH'
                ? 'Imtihon boshqa qurilmada boshlangan. O‘sha qurilmadan davom eting yoki admin yordamini so‘rang.'
                : t.identityVerifyError,
        );
        return;
      }
      if (!response.ok) {
        setError(t.identityVerifyError);
        return;
      }
      if (data.match === true) {
        setVerified(true);
        setVerifyScore(typeof data.score === 'number' ? data.score : null);
        setError('');
      } else {
        const code = data?.code || '';
        setError(
          code === 'FACE_NOT_DETECTED' ? t.identityVerifyFaceNotDetected : t.identityVerifyFailed,
        );
      }
    } catch {
      setError(t.identityVerifyError);
    } finally {
      setVerifying(false);
    }
  };

  const handleStart = async () => {
    if (exam.has_pin && !pin) {
      setError(t.enterPin);
      return;
    }
    setStarting(true);
    setError('');
    try {
      const res = await fetch(apiUrl(`/api/student/exams/${exam.id}/start`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...examAuthHeaders(token),
        },
        body: JSON.stringify({ pin }),
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
      if (!res.ok) {
        setError(data?.error || t.preExamStartError);
        setStarting(false);
        return;
      }
      if (!data?.exam || data.studentExamId == null) {
        setError(t.preExamServerError);
        setStarting(false);
        return;
      }
      if (data.deviceToken) {
        setDeviceSessionToken(data.deviceToken);
      }
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
      setStarting(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="w-full min-h-[calc(100dvh-5.5rem)] flex flex-col bg-gray-50"
    >
      <div className="w-full max-w-6xl mx-auto px-3 sm:px-6 py-4 sm:py-6">
        <div className="mb-5 sm:mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3">
            <InstituteLogo size="sm" />
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">{t.preExamTitle}</h1>
              <p className="text-sm text-slate-500 mt-0.5">{exam.title}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs font-medium">
            <span className={`px-2.5 py-1 rounded-full ${cameraReady ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>
              {cameraReady ? '● Kamera' : '○ Kamera'}
            </span>
            <span className={`px-2.5 py-1 rounded-full ${verified ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>
              {verified ? '● Yuz' : '○ Yuz'}
            </span>
            <span className={`px-2.5 py-1 rounded-full ${livenessPassed ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>
              {livenessPassed ? '● Jonlilik' : '○ Jonlilik'}
            </span>
          </div>
        </div>

      <Card className="w-full rounded-xl border border-indigo-200/60 bg-white shadow-[0_12px_40px_-16px_rgba(14,116,144,0.25)]">
        <CardContent className="space-y-6 px-4 sm:px-6 lg:px-8 pb-8 pt-6">
          {error && (
            <AdminAlert type="error">{error}</AdminAlert>
          )}
          {mediaHint && !error && (
            <AdminAlert type="warning">{mediaHint}</AdminAlert>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 xl:gap-10 items-start">
            <div className="lg:col-span-5 space-y-4 min-w-0">
              <div className="rounded-xl border border-amber-200 bg-amber-50/60 overflow-hidden">
                <div className="px-4 py-3 sm:px-5 border-b border-amber-200/50 bg-amber-100/40">
                  <h3 className="font-bold text-amber-950 text-sm sm:text-base tracking-tight">{t.preExamVacRulesTitle}</h3>
                  <p className="text-xs sm:text-sm text-amber-950/85 mt-1.5 leading-relaxed">{t.preExamVacRulesIntro}</p>
                </div>
                <div
                  ref={vacRulesBoxRef}
                  className="max-h-52 sm:max-h-64 lg:max-h-[min(70vh,520px)] overflow-y-auto overscroll-y-contain px-4 py-4 sm:px-5 text-sm text-gray-900 leading-relaxed space-y-2.5 border-b border-amber-100/60"
                >
                  {t.preExamVacRulesItems.split('|||RULE|||').map((line, i) => (
                    <div key={i} className="flex gap-2.5">
                      <span className="shrink-0 font-bold text-amber-800 tabular-nums w-6 text-right">{i + 1}.</span>
                      <p className="min-w-0 flex-1">{line.trim()}</p>
                    </div>
                  ))}
                </div>
                {!vacRulesScrolledEnd && (
                  <p className="px-4 py-2 text-center text-xs font-medium text-amber-900 bg-amber-100/50">
                    ↓ {t.preExamVacRulesScrollHint}
                  </p>
                )}
              </div>
            </div>

            <div className="lg:col-span-7 space-y-6 min-w-0">
          {/* Kamera — keng ekranda to'liq ustun. Chap taraftagi VAC qoidalari ro'yxati
              uzun bo'lsa ham kamera ko'rinishda qolishi uchun sticky. */}
          <div className="sticky top-24 z-10">
          <div
            className="relative w-full rounded-lg sm:rounded-xl overflow-hidden border-2 sm:border-4 border-gray-200 shadow-xl bg-black aspect-video max-h-[min(58vh,640px)] lg:max-h-[min(72vh,720px)] mx-auto lg:mx-0"
          >
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
              style={{ transform: 'scaleX(-1)' }}
            />
            <canvas ref={canvasRef} className="hidden" aria-hidden />
            <canvas ref={livenessCanvasRef} className="hidden" aria-hidden />
            {!cameraReady && (
              <div className="absolute inset-0 flex items-center justify-center text-gray-500 font-medium bg-white ">
                {t.preExamWaitCamera}
              </div>
            )}
            {showVerifyCelebration && (
              <IdentityVerifiedSuccess
                title={t.identityVerifySuccessTitle}
                subtitle={t.identityVerifySuccessSubtitle}
                scoreLabel={
                  verifyScore != null
                    ? t.identityVerifyScore.replace('{score}', String(Math.round(verifyScore * 100)))
                    : undefined
                }
              />
            )}
            {/* Kamera holati badge */}
            <div className="absolute top-3 left-3 flex items-center gap-2 bg-black/50 rounded-full px-3 py-1.5">
              <span className={`w-2.5 h-2.5 rounded-full ${cameraReady ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`} />
              <span className="text-white text-xs font-medium">
                {cameraReady ? t.preExamCameraActive : t.preExamWaitCamera}
              </span>
            </div>
            {/* Mikrofon holati badge */}
            <div className="absolute top-3 right-3 flex items-center gap-2 bg-black/50 rounded-full px-3 py-1.5">
              <span className={`w-2.5 h-2.5 rounded-full ${micReady ? 'bg-green-400' : 'bg-red-400'}`} />
              <span className="text-white text-xs font-medium">
                {micReady ? t.preExamMicActive : t.preExamMicInactive}
              </span>
            </div>
          </div>
          </div>

          {exam.custom_rules && (
            <div className="p-4 border border-gray-200 bg-white rounded-lg sm:rounded-xl shadow-sm">
              <h4 className="font-semibold text-sm text-gray-800 mb-1">{t.customRules}</h4>
              <p className="text-sm text-gray-600 whitespace-pre-wrap">{exam.custom_rules}</p>
            </div>
          )}

          <div className="space-y-4 w-full">
              {/* Shaxs tasdiqlash */}
              {user.profile_image ? (
                <div
                  className={`p-5 border rounded-xl shadow-sm space-y-4 transition-colors duration-500 ${
                    verified
                      ? 'border-emerald-300 bg-emerald-50/60 ring-1 ring-emerald-200'
                      : 'border-gray-200 bg-white'
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <div className="relative shrink-0">
                      <img
                        src={user.profile_image}
                        alt={t.profilePhotoLabel}
                        className={`w-16 h-16 rounded-lg object-cover border-2 border-white shadow-md ${
                          verified ? 'ring-2 ring-emerald-300' : 'ring-2 ring-indigo-200'
                        }`}
                        referrerPolicy="no-referrer"
                      />
                      {verified && (
                        <span className="absolute -bottom-1.5 -right-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg ring-2 ring-white">
                          <Check className="h-4 w-4 stroke-[3]" aria-hidden />
                        </span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="font-bold text-slate-900 text-base">{t.identityVerification}</h4>
                      <p className="text-xs text-slate-500 mt-0.5">{user.name || user.id}</p>
                    </div>
                  </div>

                  <p className="text-xs text-slate-600 leading-relaxed bg-white rounded-xl px-3 py-2 border border-slate-100">
                    {t.identityVerifyTips}
                  </p>

                  {/* Yuz pozitsiyasi gate — verify'dan oldin to'g'ri o'tirishni ta'minlaydi */}
                  {!verified && (
                    <div
                      className={`rounded-xl px-3 py-2.5 border flex items-center gap-2 ${
                        positionOk
                          ? 'bg-green-50 border-green-200'
                          : 'bg-amber-50 border-amber-200'
                      }`}
                    >
                      <span
                        className={`inline-block h-2.5 w-2.5 rounded-full shrink-0 ${
                          positionOk ? 'bg-green-500' : 'bg-amber-500 animate-pulse'
                        }`}
                      />
                      <div className="min-w-0">
                        <p className="text-[11px] uppercase tracking-wide text-gray-500 font-medium leading-none mb-0.5">
                          {t.preExamPositionTitle}
                        </p>
                        <p
                          className={`text-sm font-semibold ${
                            positionOk ? 'text-green-700' : 'text-amber-700'
                          }`}
                        >
                          {(
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
                          )[positionStatus]}
                        </p>
                      </div>
                    </div>
                  )}

                  <AdminBtn
                    onClick={verifyIdentity}
                    disabled={!cameraReady || verifying || verified || !positionOk}
                    variant={verified ? 'emerald' : 'blue'}
                    size="lg"
                    loading={verifying}
                    className="w-full"
                  >
                    {verified ? t.identityVerified : t.identityVerifyBtn}
                  </AdminBtn>

                  {/* Jonlilik: avtomatik, tugmasiz */}
                  <div className="space-y-2 pt-1">
                    <p className="text-xs text-gray-600">{t.preExamLivenessTitle}</p>
                    {verified && !livenessPassed && (
                      <p className="text-sm text-gray-700">{t.preExamLivenessSelfHint}</p>
                    )}
                    {verified && livenessChecking && (
                      <p className="text-sm text-indigo-700 flex items-center gap-2">
                        <span className="inline-block h-2 w-2 rounded-full bg-indigo-500 animate-pulse" />
                        {t.preExamLivenessWaiting}
                      </p>
                    )}
                    {livenessPassed && (
                      <p className="text-sm font-semibold text-green-700">{t.preExamLivenessPassed}</p>
                    )}
                    {verified && !livenessPassed && livenessFailed && !livenessChecking && (
                      <AdminBtn
                        variant="ghost"
                        size="sm"
                        className="w-full"
                        onClick={() => {
                          setLivenessFailed(false);
                          setError('');
                          setLivenessRetryKey((k) => k + 1);
                        }}
                      >
                        {t.preExamLivenessRetryBtn}
                      </AdminBtn>
                    )}
                  </div>
                </div>
              ) : (
                <div className="p-4 border border-red-500/30 bg-red-50/80 rounded-xl text-red-800 text-sm">
                  {t.profilePhotoMissingExam}
                </div>
              )}

              {/* PIN kodi */}
              {exam.has_pin && (
                <div className="p-4 border border-gray-200 bg-white rounded-xl shadow-sm">
                  <label className="block text-[13px] font-medium text-gray-600 mb-1.5">
                    {t.enterPin}
                  </label>
                  <AdminInput
                    type="password"
                    value={pin}
                    onChange={(e) => setPin(e.target.value)}
                    placeholder="• • • • • •"
                    className="text-center tracking-widest text-[17px]"
                  />
                </div>
              )}
            </div>
            </div>
          </div>

          {/* Rozilik + tugmalar */}
          <div className="pt-6 border-t border-gray-200/60 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <label className="flex items-start gap-3 cursor-pointer p-3 hover:bg-white rounded-lg transition-colors flex-1">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                disabled={!vacRulesScrolledEnd}
                className="w-5 h-5 mt-0.5 text-black rounded border-gray-300 focus:ring-black transition-all shrink-0 disabled:opacity-40"
              />
              <span className="font-medium text-gray-800 text-sm leading-snug">{t.preExamAgreeAllRules}</span>
            </label>
            <div className="flex flex-col gap-3 shrink-0 items-end">
              {/* Nima sabab tugma yopiq ekanini ko'rsatish */}
              {(() => {
                const blocked: string[] = [];
                if (!cameraReady) blocked.push(t.preExamBlockedCamera);
                if (!vacRulesScrolledEnd) blocked.push(t.preExamBlockedRules);
                if (!agreed) blocked.push(t.preExamBlockedAgree);
                if (exam.has_pin && !pin) blocked.push(t.preExamBlockedPin);
                if (!user.profile_image) blocked.push(t.preExamBlockedPhoto);
                if (!verified) blocked.push(t.preExamBlockedIdentity);
                if (!livenessPassed || livenessChecking) blocked.push(t.preExamBlockedLiveness);
                if (blocked.length === 0) return null;
                return (
                  <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 max-w-xs text-right">
                    <p className="font-semibold mb-1">{t.preExamStartChecklist}</p>
                    <ul className="space-y-0.5">
                      {blocked.map((b) => (
                        <li key={b} className="flex items-center justify-end gap-1.5">
                          <span>{b}</span>
                          <span className="text-amber-500">✗</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })()}
              <div className="flex gap-2.5">
                <AdminBtn
                  variant="ghost"
                  size="lg"
                  onClick={onCancel}
                  disabled={starting}
                >
                  {t.cancel}
                </AdminBtn>
                <AdminBtn
                  variant="blue"
                  size="lg"
                  loading={starting}
                  onClick={handleStart}
                  disabled={
                    !cameraReady ||
                    !agreed ||
                    !vacRulesScrolledEnd ||
                    (exam.has_pin && !pin) ||
                    !user.profile_image ||
                    !verified ||
                    !livenessPassed ||
                    livenessChecking
                  }
                  className="px-8"
                >
                  {starting ? t.preExamStarting : t.takeExam}
                </AdminBtn>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
      </div>
    </motion.div>
  );
}
