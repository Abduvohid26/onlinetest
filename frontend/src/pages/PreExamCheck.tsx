import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { motion } from 'motion/react';
import { translations, Language, formatPreExamMediaAccessFailure } from '../i18n';
import { readJsonSafe } from '../lib/http';
import { apiUrl } from '../lib/apiUrl';
import { examAuthHeaders, setDeviceSessionToken } from '../lib/deviceFingerprint';
import { compressVideoFrameToJpeg } from '../lib/compressToJpeg';
import { FacePositionChecker, YawChallengeTracker, type FacePositionStatus, challengeYawMatches, challengeYawCentered } from '../lib/facePositionCheck';
import { IdentityVerifiedSuccess } from '../components/IdentityVerifiedSuccess';
import { AdminBtn, AdminAlert, AdminInput } from './admin/ui';
import { Check } from 'lucide-react';

/* Sahifa ichidagi qisqa matnlar (uz/ru/en) — katta i18n fayliga tegmasdan. */
const PRE_L: Record<Language, Record<string, string>> = {
  uz: { stepCamera: 'Kamera', stepRules: 'Qoidalar', stepIdentity: 'Shaxs', stepLiveness: 'Jonlilik', important: 'Muhim', rulesTitle: 'Imtihon qoidalari' },
  ru: { stepCamera: 'Камера', stepRules: 'Правила', stepIdentity: 'Личность', stepLiveness: 'Живость', important: 'Важно', rulesTitle: 'Правила экзамена' },
  en: { stepCamera: 'Camera', stepRules: 'Rules', stepIdentity: 'Identity', stepLiveness: 'Liveness', important: 'Important', rulesTitle: 'Exam rules' },
};
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

// Active liveness challenge (bosh burish) — passiv piksel-farq tekshiruvidan keyin,
// video-replay/statik-foto spoofing'ga qarshi qo'shimcha qatlam sifatida ishlaydi.
const CHALLENGE_CENTER_STREAK_NEEDED = 4; // markazda barqaror bo'lishi kerak bo'lgan freym soni
const CHALLENGE_TIMEOUT_MS = 12000;

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
  // qayta talab qilinmaydi. DIQQAT: PIN retake'da HAM talab qilinadi (bu faqat pozitsiya
  // gate uchun); shaxs (identity) va jonlilik ham har safar tekshiriladi.
  const isRetakeResolved = Boolean(
    isRetake ||
      exam?.session_phase === 'after_retake' ||
      (exam?.technical_retakes_used ?? 0) > 0 ||
      (exam?.identity_retakes_used ?? 0) > 0,
  );
  // PIN kerakmi — exam obyekti ikki xil shaklda kelishi mumkin: imtihonlar ro'yxati
  // `has_pin` (bool) beradi, /start javobi esa `pin` (qiymat). Retake "Hozir qayta
  // boshlash" oqimida activeExam /start shaklida bo'ladi — shu sabab ikkalasini ham
  // tekshiramiz, aks holda PIN maydoni ko'rinmay qolardi (lekin backend PIN so'raydi).
  const needsPin = Boolean(exam?.has_pin) || Boolean(exam?.pin);
  const [cameraReady, setCameraReady] = useState(false);
  const [micReady, setMicReady] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  /** Kamera bor, mikrofon ochilmagan — qizil xato emas, ogohlantirish */
  const [mediaHint, setMediaHint] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState(false);
  const [showVerifyCelebration, setShowVerifyCelebration] = useState(false);
  const [livenessPassed, setLivenessPassed] = useState(false);
  const [livenessChecking, setLivenessChecking] = useState(false);
  const [livenessRetryKey, setLivenessRetryKey] = useState(0);
  const [livenessFailed, setLivenessFailed] = useState(false);
  /** Passiv piksel-farq tekshiruvi o'tdi — active challenge (bosh burish) boshlanadi. */
  const [passiveMotionOk, setPassiveMotionOk] = useState(false);
  const [challengeDirection, setChallengeDirection] = useState<'left' | 'right' | null>(null);
  const [challengeStatus, setChallengeStatus] = useState<
    'idle' | 'waiting_turn' | 'waiting_center' | 'passed' | 'failed'
  >('idle');
  const [challengeRetryKey, setChallengeRetryKey] = useState(0);
  const challengeCenterStreakRef = useRef(0);
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
      // Bir marta oxirigacha o'qilgach, tepaga qaytganda ham checkbox ishlashi uchun latch.
      if (end) setVacRulesScrolledEnd(true);
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

  /** Shaxs tasdiqlandi — tugmasiz: kamera kadrlarida yengil harakat qidiriladi
   *  (statik foto/video-replay'ga qarshi arzon birinchi qatlam). O'tsa, active
   *  bosh-burish challenge boshlanadi (keyingi effekt). */
  useEffect(() => {
    if (!verified || passiveMotionOk || !cameraReady) return;

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
            setPassiveMotionOk(true);
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
  }, [verified, cameraReady, passiveMotionOk, livenessRetryKey]);

  /** Passiv tekshiruv o'tgandan keyin — active challenge: tasodifiy yo'nalishga
   *  burilish so'raladi, so'ng markazga qaytish tasdiqlanadi. */
  useEffect(() => {
    if (!verified || !passiveMotionOk || livenessPassed || !cameraReady) return;
    const video = videoRef.current;
    if (!video) return;

    let cancelled = false;
    let timeoutId: number | null = null;
    const direction: 'left' | 'right' = Math.random() < 0.5 ? 'left' : 'right';
    setChallengeDirection(direction);
    setChallengeStatus('waiting_turn');
    challengeCenterStreakRef.current = 0;

    const tracker = new YawChallengeTracker(video, (yaw) => {
      if (cancelled) return;
      setChallengeStatus((prev) => {
        if (prev === 'waiting_turn') {
          if (yaw !== null && challengeYawMatches(direction, yaw)) {
            challengeCenterStreakRef.current = 0;
            return 'waiting_center';
          }
          return prev;
        }
        if (prev === 'waiting_center') {
          if (yaw !== null && challengeYawCentered(yaw)) {
            challengeCenterStreakRef.current += 1;
            if (challengeCenterStreakRef.current >= CHALLENGE_CENTER_STREAK_NEEDED) {
              return 'passed';
            }
          } else {
            challengeCenterStreakRef.current = 0;
          }
          return prev;
        }
        return prev;
      });
    });

    void tracker.init().then((ok) => {
      if (cancelled) {
        tracker.dispose();
        return;
      }
      if (ok) {
        tracker.start();
        timeoutId = window.setTimeout(() => {
          setChallengeStatus((s) => (s === 'passed' ? s : 'failed'));
        }, CHALLENGE_TIMEOUT_MS);
      } else {
        // Model yuklanmadi (CDN bloklangan/eski qurilma) — challenge skip,
        // imtihon bloklanmasin (passiv tekshiruv allaqachon o'tgan).
        setChallengeStatus('passed');
      }
    });

    return () => {
      cancelled = true;
      if (timeoutId !== null) window.clearTimeout(timeoutId);
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
        const sessionLocked =
          code === 'DEVICE_MISMATCH' ||
          code === 'DEVICE_TOKEN_REQUIRED' ||
          code === 'DEVICE_FINGERPRINT_REQUIRED' ||
          code === 'VAC_HMAC_SESSION_MISSING' ||
          code.startsWith('VAC_');
        setError(
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
        setError(t.identityVerifyError);
        return;
      }
      if (data.match === true) {
        setVerified(true);
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

  const handleEnter = async () => {
    if (needsPin && !pin) {
      setError(t.enterPin);
      return;
    }
    setError('');
    setStarting(true);
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
        setError(data?.error || t.preExamStartError);
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
          preExamPin: pin,
        },
        data.studentExamId,
      );
    } catch {
      setError(t.preExamNetworkError);
    } finally {
      setStarting(false);
    }
  };

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

  // Progress qadamlari (localized label + bajarilgan holati).
  const rulesDone = vacRulesScrolledEnd && agreed;
  const steps = [
    { label: PRE_L[lang].stepCamera, done: cameraReady },
    { label: PRE_L[lang].stepRules, done: rulesDone },
    { label: PRE_L[lang].stepIdentity, done: verified },
    { label: PRE_L[lang].stepLiveness, done: livenessPassed },
  ];
  const activeStepIdx = steps.findIndex((s) => !s.done);

  const blocked: string[] = [];
  if (!cameraReady) blocked.push(t.preExamBlockedCamera);
  if (!micReady) blocked.push(t.preExamBlockedMic);
  if (!vacRulesScrolledEnd) blocked.push(t.preExamBlockedRules);
  if (!agreed) blocked.push(t.preExamBlockedAgree);
  if (needsPin && !pin) blocked.push(t.preExamBlockedPin);
  if (!user.profile_image) blocked.push(t.preExamBlockedPhoto);
  if (!verified) blocked.push(t.preExamBlockedIdentity);
  if (!livenessPassed || livenessChecking) blocked.push(t.preExamBlockedLiveness);
  const canStart = blocked.length === 0;

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
          <div className="min-w-0">
            <h1 className="text-[19px] sm:text-[22px] font-bold text-gray-900 tracking-tight leading-tight">
              {t.preExamTitle}
            </h1>
            <p className="text-[13px] text-gray-500 mt-0.5 truncate">{exam.title}</p>
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
          <div className="space-y-2">
            {error && <AdminAlert type="error">{error}</AdminAlert>}
            {mediaHint && !error && <AdminAlert type="warning">{mediaHint}</AdminAlert>}
          </div>
        )}

        {/* ── Body (mobilda bitta scroll, desktopda ikki ustun) ── */}
        <div className="flex-1 min-h-0 flex flex-col gap-3 overflow-hidden">
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain lg:overflow-hidden">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5 lg:h-full lg:min-h-0">
          {/* Rules card */}
          <section className="flex flex-col rounded-xl border border-gray-200 bg-white overflow-hidden min-h-0 max-h-[min(52dvh,520px)] lg:max-h-none lg:h-full">
            <header className="shrink-0 px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="w-8 h-8 rounded-lg bg-gray-100 text-gray-500 flex items-center justify-center shrink-0">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.9} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                </span>
                <h3 className="font-semibold text-[14px] text-gray-900 truncate">{PRE_L[lang].rulesTitle}</h3>
              </div>
              <span className="shrink-0 inline-flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-wide text-amber-700 bg-amber-50 border border-amber-100 px-2 py-0.5 rounded-md">
                {PRE_L[lang].important}
              </span>
            </header>
            <div
              ref={vacRulesBoxRef}
              data-testid="vac-rules-box"
              className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain px-4 py-3 text-[13px] text-gray-700 leading-relaxed space-y-3 touch-pan-y"
            >
              <p className="text-[12.5px] text-gray-500">{t.preExamVacRulesIntro}</p>
              {t.preExamVacRulesItems.split('|||RULE|||').map((line, i) => (
                <div key={i} className="flex gap-2.5">
                  <span className="shrink-0 flex items-center justify-center w-5 h-5 rounded-md bg-indigo-50 text-indigo-600 font-bold text-[11px] tabular-nums mt-0.5">{i + 1}</span>
                  <p className="min-w-0 flex-1">{line.trim()}</p>
                </div>
              ))}
            </div>
            {!vacRulesScrolledEnd && (
              <p className="shrink-0 px-3 py-2 text-center text-[11px] font-medium text-gray-500 bg-gray-50 border-t border-gray-100">
                ↓ {t.preExamVacRulesScrollHint}
              </p>
            )}
          </section>

          {/* Camera + identity */}
          <section className="flex flex-col gap-3 min-h-0 lg:overflow-y-auto lg:overscroll-y-contain">
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

            {user.profile_image ? (
              <div className={`p-4 border rounded-xl space-y-3 transition-colors ${verified ? 'border-emerald-200 bg-emerald-50/40' : 'border-gray-200 bg-white'}`}>
                <div className="flex items-center gap-3">
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

                {!verified && !isRetakeResolved && (
                  <div className={`rounded-lg px-3 py-2 border flex items-center gap-2 transition-colors ${positionOk ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
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
                  className="w-full"
                >
                  {verified ? t.identityVerified : t.identityVerifyBtn}
                </AdminBtn>

                {(verified || livenessChecking || livenessPassed || livenessFailed || challengeStatus !== 'idle') && (
                  <div className="text-[12.5px] text-gray-600">
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
                          setError('');
                          setLivenessRetryKey((k) => k + 1);
                        }}
                      >
                        {t.preExamLivenessRetryBtn}
                      </AdminBtn>
                    )}
                    {(challengeStatus === 'waiting_turn' || challengeStatus === 'waiting_center') && (
                      <p className="font-semibold text-indigo-700 flex items-center gap-1.5">
                        <span className="inline-block h-1.5 w-1.5 rounded-full bg-indigo-500 animate-pulse" />
                        {challengeStatus === 'waiting_turn'
                          ? challengeDirection === 'left'
                            ? t.preExamChallengeTurnLeft
                            : t.preExamChallengeTurnRight
                          : t.preExamChallengeReturnCenter}
                      </p>
                    )}
                    {challengeStatus === 'failed' && (
                      <AdminBtn
                        variant="ghost"
                        size="sm"
                        className="w-full mt-1"
                        onClick={() => {
                          setChallengeStatus('idle');
                          setError('');
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
              </div>
            ) : (
              <div className="p-3 border border-red-200 bg-red-50 rounded-lg text-red-700 text-[12.5px] font-medium">
                {t.profilePhotoMissingExam}
              </div>
            )}
          </section>
            </div>
          </div>

        {/* ── Footer action bar (doim ko'rinadi, scroll ustida emas) ── */}
        <div className="shrink-0 rounded-xl border border-gray-200 bg-white p-4 sm:p-5 space-y-3 shadow-[0_-4px_24px_rgba(15,23,42,0.06)]">
          {needsPin && (
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 pb-4 border-b border-gray-100">
              <div className="flex items-center gap-2.5 shrink-0">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gray-100 text-gray-500">
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                </span>
                <label htmlFor="exam-pin" className="min-w-0">
                  <span className="block text-[13.5px] font-semibold text-gray-900 leading-tight">{t.enterPin}</span>
                  <span className="block text-[11.5px] text-gray-500 leading-tight mt-0.5">{t.preExamPinHint}</span>
                </label>
              </div>
              <AdminInput
                id="exam-pin"
                type="password"
                inputMode="numeric"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="••••••"
                className="text-center text-lg tracking-[0.4em] font-semibold h-11 sm:ml-auto sm:max-w-[220px]"
                autoComplete="off"
              />
            </div>
          )}

          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <label className="flex items-start gap-2.5 cursor-pointer flex-1 min-w-0">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                disabled={!vacRulesScrolledEnd}
                className="w-4 h-4 mt-0.5 accent-indigo-600 rounded border-gray-300 shrink-0 disabled:opacity-40"
              />
              <span className="font-medium text-gray-700 text-[12.5px] sm:text-[13px] leading-snug">{t.preExamAgreeAllRules}</span>
            </label>
            <div className="flex gap-2 w-full sm:w-auto shrink-0">
              <AdminBtn variant="ghost" size="lg" onClick={onCancel} className="flex-1 sm:flex-none">
                {t.cancel}
              </AdminBtn>
              <AdminBtn
                variant="blue"
                size="lg"
                onClick={() => void handleEnter()}
                disabled={!canStart || starting}
                loading={starting}
                className="flex-1 sm:flex-none sm:px-8"
              >
                {starting ? t.preExamStarting : t.preExamEnterExam}
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
    </motion.div>
  );
}
