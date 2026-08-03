import { openPreferredProctorStream } from './preferredCameraStream';

/**
 * PreExamCheck → ExamRoom o'tishida kamera/mikrofonni ikki marta (bir marta
 * preview uchun, bir marta ExamRoom uchun) alohida-alohida so'rash sezilarli
 * kechikish berardi — OS/drayver eski oqimni bo'shatib ulgurmasdan turib
 * yangisi so'ralganda "Kamera va mikrofon tayyorlanmoqda" ekrani osilib
 * qolardi. Bu yerda "Kirish" bosilgan zahoti (tarmoq so'rovi bilan PARALLEL)
 * ExamRoom uchun kerak bo'ladigan oqim OLDINDAN so'raladi — shu bilan
 * ExamRoom mount bo'lguncha kamera allaqachon ochiq/ochilayotgan bo'ladi.
 */
let prewarmPromise: Promise<MediaStream> | null = null;

export function prewarmProctorStream(): void {
  if (prewarmPromise) return;
  prewarmPromise = openPreferredProctorStream().catch((err) => {
    prewarmPromise = null;
    throw err;
  });
}

/**
 * Oldindan tayyorlangan oqimni bir martalik "da'vo qiladi". Topilmasa (hali
 * so'ralmagan yoki allaqachon ishlatilgan) — `null`, chaqiruvchi o'zi
 * `openPreferredProctorStream()` bilan odatdagidek so'rasin.
 */
export function claimPrewarmedProctorStream(): Promise<MediaStream> | null {
  const p = prewarmPromise;
  prewarmPromise = null;
  return p;
}

/**
 * `/start` so'rovi xato bersa (yoki foydalanuvchi bekor qilsa) ExamRoom
 * ochilmaydi — oldindan so'ralgan kamera hech kim tomonidan da'vo
 * qilinmay, fonda ochiq qolib ketmasin (kamera indikatori yonib turadi).
 */
export function discardPrewarmedProctorStream(): void {
  const p = claimPrewarmedProctorStream();
  if (!p) return;
  p.then(
    (stream) => stream.getTracks().forEach((t) => t.stop()),
    () => {
      /* prewarm allaqachon rad etilgan — tozalanadigan narsa yo'q */
    },
  );
}
