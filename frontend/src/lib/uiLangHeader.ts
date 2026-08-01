import type { Language } from '../i18n';

/** Admin/staff so'rovlarida backend API xatolarini UI tiliga bog'lash. */
export function uiLangHeader(lang: Language): { 'X-UI-Lang': Language } {
  return { 'X-UI-Lang': lang };
}

export function authHeaders(token: string, lang?: Language): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    ...(lang ? uiLangHeader(lang) : {}),
  };
}
