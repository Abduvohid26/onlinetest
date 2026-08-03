/** Admin fetch 401 yoki 403 qaytarsa chaqiring — App avtomatik logout qiladi. */
export function signalAuthError() {
  window.dispatchEvent(new Event('auth:error'));
}

export function checkAdminAuthResponse(res: Response): boolean {
  if (res.status === 401 || res.status === 403) {
    signalAuthError();
    return false;
  }
  return true;
}

export function checkStudentAuthResponse(res: Response): boolean {
  if (res.status === 401) {
    signalAuthError();
    return false;
  }
  return true;
}

/**
 * Uzoq (AI tarjima/tahlil bilan) so'rovlar uchun — `fetch` odatda hech qachon
 * o'zi to'xtamaydi (brauzer standart timeout qo'ymaydi), shuning uchun
 * tarmoq uzilib qolsa foydalanuvchi cheksiz kutib qoladi. `timeoutMs`dan
 * keyin so'rov bekor qilinadi va aniq `TimeoutError` (`DOMException`) beriladi
 * — chaqiruvchi buni oddiy tarmoq xatosidan alohida xabar bilan ko'rsatishi
 * mumkin (masalan "juda uzoq davom etdi" vs "internet uzildi").
 */
export async function fetchWithTimeout(
  input: string,
  init: RequestInit = {},
  timeoutMs = 240_000,
): Promise<Response> {
  const controller = new AbortController();
  const id = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(id);
  }
}

/** Avoid SyntaxError when the server returns HTML (e.g. SPA fallback) instead of JSON. */
export async function readJsonSafe<T = unknown>(res: Response): Promise<T | null> {
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) return null;
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** GET /api/admin/users — { results, total } yoki eski massiv. */
export function parseAdminUsersList<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === 'object' && Array.isArray((data as { results?: unknown }).results)) {
    return (data as { results: T[] }).results;
  }
  return [];
}
