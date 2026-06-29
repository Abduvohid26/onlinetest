import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { translations, Language } from '../i18n';
import { InstituteLogo } from '../components/InstituteLogo';
import { readJsonSafe } from '../lib/http';
import { apiUrl } from '../lib/apiUrl';
import { AdminInput, AdminField, AdminBtn, AdminAlert } from './admin/ui';

interface LoginProps {
  onLogin: (token: string, user: any) => void;
  lang: Language;
  setLang: (l: Language) => void;
}

const LS_REMEMBER = 'fjsti_login_remember';
const LS_ID = 'fjsti_login_saved_id';
const LS_PW_LEGACY = 'fjsti_login_saved_password';

const LANGS: Language[] = ['uz', 'ru', 'en'];

export function Login({ onLogin, lang, setLang }: LoginProps) {
  const [id, setId] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const t = translations[lang];

  useEffect(() => {
    try {
      localStorage.removeItem(LS_PW_LEGACY);
      if (localStorage.getItem(LS_REMEMBER) === '1') {
        setRememberMe(true);
        const sid = localStorage.getItem(LS_ID);
        if (sid) setId(sid);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const persistRemember = (loginId: string, remember: boolean) => {
    try {
      if (remember) {
        localStorage.setItem(LS_REMEMBER, '1');
        localStorage.setItem(LS_ID, loginId);
      } else {
        localStorage.removeItem(LS_REMEMBER);
        localStorage.removeItem(LS_ID);
      }
    } catch {
      /* ignore */
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch(apiUrl('/api/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, password }),
      });
      const data = await readJsonSafe<{ token?: string; user?: any; error?: string }>(res);
      if (!res.ok) throw new Error(data?.error || t.loginFailed);
      if (!data?.token || !data?.user) throw new Error(t.loginInvalidServerResponse);
      persistRemember(id, rememberMe);
      onLogin(data.token, data.user);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col lg:flex-row relative overflow-hidden bg-[#f5f5f7]">
      {/* Chap: branding (desktop) */}
      <div className="hidden lg:flex lg:w-[44%] xl:w-[42%] relative flex-col justify-between p-10 xl:p-14 bg-gradient-to-br from-slate-900 via-indigo-900 to-indigo-800 text-white overflow-hidden">
        <div className="absolute inset-0 opacity-25 pointer-events-none">
          <div className="absolute -top-24 -left-24 w-80 h-80 rounded-full bg-indigo-400/20 blur-3xl" />
          <div className="absolute bottom-0 right-0 w-96 h-96 rounded-full bg-indigo-500/20 blur-3xl" />
        </div>
        <div className="relative z-10">
          <InstituteLogo size="md" className="brightness-0 invert opacity-95" />
        </div>
        <div className="relative z-10 space-y-5 max-w-md">
          <h1 className="text-3xl xl:text-4xl font-bold tracking-tight leading-tight">{t.appBrandTitle}</h1>
          <p className="text-indigo-100/90 text-[15px] leading-relaxed">{t.loginSubtitle}</p>
          <ul className="space-y-3 text-sm text-indigo-50/80">
            <li className="flex items-center gap-2.5">
              <span className="w-8 h-8 rounded-lg bg-white/15 flex items-center justify-center shrink-0">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
              </span>
              {lang === 'ru' ? 'Безопасная сдача экзаменов' : lang === 'en' ? 'Secure online exams' : 'Xavfsiz onlayn imtihonlar'}
            </li>
            <li className="flex items-center gap-2.5">
              <span className="w-8 h-8 rounded-lg bg-white/15 flex items-center justify-center shrink-0">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </span>
              {lang === 'ru' ? 'Результаты в реальном времени' : lang === 'en' ? 'Real-time results' : 'Real vaqtda natijalar'}
            </li>
          </ul>
        </div>
        <p className="relative z-10 text-[11px] text-indigo-200/70">
          © {new Date().getFullYear()} FJSTI · Farg‘ona jamoat salomatligi tibbiyot instituti
        </p>
      </div>

      {/* O‘ng: forma */}
      <div className="flex-1 flex flex-col min-h-screen lg:min-h-0">
        <div className="flex items-center justify-between px-4 sm:px-8 pt-5 sm:pt-6">
          <div className="lg:hidden flex items-center gap-2.5">
            <InstituteLogo size="sm" />
            <span className="text-[15px] font-bold text-gray-900 truncate max-w-[200px]">{t.appBrandTitle}</span>
          </div>
          <div className="flex items-center h-9 rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm ml-auto">
            {LANGS.map((l, i) => (
              <button
                key={l}
                type="button"
                onClick={() => setLang(l)}
                className={`h-full px-3 sm:px-3.5 text-xs sm:text-[13px] font-semibold transition-all ${
                  i > 0 ? 'border-l border-gray-200' : ''
                } ${lang === l ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-800'}`}
              >
                {l === 'uz' ? "O'z" : l === 'ru' ? 'Ру' : 'En'}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 flex items-center justify-center px-4 sm:px-8 py-8 sm:py-12">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            className="w-full max-w-[420px]"
          >
            <div className="mb-8 lg:mb-10 text-center lg:text-left">
              <h2 className="text-2xl sm:text-[28px] font-bold tracking-tight text-gray-900">{t.login}</h2>
              <p className="text-gray-500 mt-2 text-[15px]">{t.loginSubtitle}</p>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 shadow-[0_4px_24px_-12px_rgba(0,0,0,0.12)] p-6 sm:p-8">
              <form onSubmit={handleLogin} className="space-y-5" noValidate>
                <AdminField label={t.userId} required>
                  <AdminInput
                    value={id}
                    onChange={(e) => setId(e.target.value)}
                    required
                    placeholder={lang === 'ru' ? 'masalan, demo_student' : lang === 'en' ? 'e.g. demo_student' : 'masalan, demo_student'}
                    autoComplete="username"
                    disabled={loading}
                  />
                </AdminField>

                <AdminField label={t.password} required>
                  <AdminInput
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    placeholder="••••••••••••"
                    autoComplete="current-password"
                    disabled={loading}
                  />
                </AdminField>

                <label className="flex items-start gap-3 cursor-pointer select-none group">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    disabled={loading}
                    className="mt-0.5 rounded-md border-gray-300 w-4 h-4 text-indigo-600 focus:ring-indigo-400/40 accent-indigo-600"
                  />
                  <span className="text-[13px] text-gray-600 leading-snug group-hover:text-gray-800 transition-colors">
                    {t.rememberLogin}
                  </span>
                </label>

                {error && (
                  <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}>
                    <AdminAlert type="error">{error}</AdminAlert>
                  </motion.div>
                )}

                <AdminBtn type="submit" variant="violet" size="lg" loading={loading} className="w-full !h-12 text-[15px] font-semibold">
                  {t.loginBtn}
                </AdminBtn>
              </form>
            </div>

            <p className="text-center lg:hidden text-[11px] text-gray-400 mt-8 leading-relaxed px-2">
              © {new Date().getFullYear()} FJSTI · Farg‘ona jamoat salomatligi tibbiyot instituti
            </p>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
