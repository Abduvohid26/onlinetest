export function toDatetimeLocalValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function defaultExamStartLocal(): string {
  const d = new Date();
  d.setSeconds(0, 0);
  d.setMinutes(0);
  d.setHours(d.getHours() + 1);
  return toDatetimeLocalValue(d);
}

export function defaultExamEndLocal(durationMinutes: number, startLocal = defaultExamStartLocal()): string {
  const start = new Date(startLocal);
  const end = new Date(start);
  end.setMinutes(end.getMinutes() + durationMinutes);
  return toDatetimeLocalValue(end);
}

export function splitDatetimeLocal(value: string): { date: string; time: string } {
  if (!value || !value.includes('T')) return { date: '', time: '' };
  const [date, time] = value.split('T');
  return { date, time: (time || '').slice(0, 5) };
}

export function joinDatetimeLocal(date: string, time: string): string {
  if (!date || !time) return '';
  return `${date}T${time}`;
}

export function fromIsoToDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return toDatetimeLocalValue(d);
}

export function toIsoFromDatetimeLocal(value: string): string | null {
  if (!isValidDatetimeLocal(value)) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function isValidDatetimeLocal(value: string): boolean {
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return false;
  const d = new Date(value);
  return !Number.isNaN(d.getTime());
}

/** Talaba/admin kartochalarida — 24 soatlik aniq format (AM/PM chalkashmasin). */
export function formatExamDateTime(iso: string | null | undefined, lang: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const loc = lang === 'ru' ? 'ru-RU' : lang === 'en' ? 'en-GB' : 'uz-UZ';
  return d.toLocaleString(loc, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function msUntil(iso: string, nowMs: number): number {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  return t - nowMs;
}

export function formatCountdown(ms: number, lang: string): string {
  if (ms <= 0) return '';
  const totalSec = Math.ceil(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (lang === 'ru') {
    if (h > 0) return `через ${h} ч ${m} мин`;
    if (m > 0) return `через ${m} мин ${s} с`;
    return `через ${s} с`;
  }
  if (lang === 'en') {
    if (h > 0) return `in ${h}h ${m}m`;
    if (m > 0) return `in ${m}m ${s}s`;
    return `in ${s}s`;
  }
  if (h > 0) return `${h} soat ${m} daqiqadan keyin`;
  if (m > 0) return `${m} daqiqa ${s} soniyadan keyin`;
  return `${s} soniyadan keyin`;
}
