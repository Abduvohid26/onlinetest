const DEVICE_TOKEN_KEY = 'vac_device_token_v1';

function simpleHash(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function getDeviceFingerprint(): string {
  try {
    const key = 'vac_device_fp_v1';
    const existing = localStorage.getItem(key);
    if (existing && existing.trim()) return existing.trim();
    const parts = [
      navigator.userAgent || '',
      (navigator as any).platform || '',
      navigator.language || '',
      String((navigator as any).hardwareConcurrency || ''),
      String((navigator as any).deviceMemory || ''),
      String(screen?.width || ''),
      String(screen?.height || ''),
      String(screen?.colorDepth || ''),
      Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    ];
    const fp = `vac-${simpleHash(parts.join('|'))}`;
    localStorage.setItem(key, fp);
    return fp;
  } catch {
    return 'vac-fallback';
  }
}

/**
 * Server /start javobidagi deviceToken — localStorage'da saqlanadi (sessionStorage EMAS).
 * Sabab: sessionStorage tab yopilganda/qayta login qilinganda o'chib ketadi — talaba
 * imtihon "In Progress" holatda qolgan holda shunchaki tabni yopib qayta ochsa yoki
 * sessiyasi tugab qayta login qilsa, token yo'qolib "DEVICE_MISMATCH" bilan imtihondan
 * butunlay chetlatilib qolardi (xuddi shu qurilmada davom etsa ham). localStorage esa
 * brauzer/qurilma darajasida saqlanadi va bu holatlarda ham saqlanib qoladi.
 */
export function setDeviceSessionToken(token: string): void {
  try {
    if (token && token.trim()) {
      localStorage.setItem(DEVICE_TOKEN_KEY, token.trim());
    }
  } catch {
    /* ignore */
  }
}

export function clearDeviceSessionToken(): void {
  try {
    localStorage.removeItem(DEVICE_TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

export function getDeviceSessionToken(): string {
  try {
    return (localStorage.getItem(DEVICE_TOKEN_KEY) || '').trim();
  } catch {
    return '';
  }
}

export function examAuthHeaders(token: string): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    // Yangi imtihon start uchun fingerprint kerak; davom etayotganda token ham yuboriladi.
    'X-Device-Fingerprint': getDeviceFingerprint(),
  };
  const deviceToken = getDeviceSessionToken();
  if (deviceToken) {
    headers['X-Device-Session-Token'] = deviceToken;
  }
  return headers;
}
