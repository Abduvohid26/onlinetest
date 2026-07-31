import React, { useEffect, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { translations, Language } from '../../i18n';

function detectLang(): Language {
  try {
    const raw = (sessionStorage.getItem('lang') || localStorage.getItem('lang') || 'uz').trim();
    return (raw === 'ru' || raw === 'en' || raw === 'uz') ? raw : 'uz';
  } catch {
    return 'uz';
  }
}

export type AdminPageMsg = {
  type: 'ok' | 'err' | 'error' | 'success' | 'warning';
  text: string;
  dismissible?: boolean;
};

type AdminAlertType = 'error' | 'success' | 'warning';

function normalizeAdminAlertType(type: AdminPageMsg['type']): AdminAlertType {
  if (type === 'ok' || type === 'success') return 'success';
  if (type === 'warning') return 'warning';
  return 'error';
}

export const ADMIN_TOAST_AUTO_MS = 20_000;
const ADMIN_TOAST_ROOT_ID = 'admin-toast-root';

const ALERT_CLS: Record<AdminAlertType, string> = {
  error: 'text-red-700 bg-red-50 border-red-200',
  success: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  warning: 'text-amber-800 bg-amber-50 border-amber-200',
};

const ALERT_ICON: Record<AdminAlertType, React.ReactNode> = {
  error: (
    <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  success: (
    <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  warning: (
    <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </svg>
  ),
};

type ToastEntry = {
  id: string;
  message: AdminPageMsg;
  onDismiss?: () => void;
};

let seq = 0;
let toasts: ToastEntry[] = [];
const expiryTimers = new Map<string, number>();
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((fn) => fn());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return toasts;
}

export function pushAdminToast(
  message: AdminPageMsg,
  onDismiss?: () => void,
  autoHideMs = ADMIN_TOAST_AUTO_MS,
): string {
  const id = `admin-toast-${++seq}`;
  toasts = [...toasts, { id, message, onDismiss }];
  emit();

  const prev = expiryTimers.get(id);
  if (prev) window.clearTimeout(prev);
  const timer = window.setTimeout(() => removeAdminToast(id), autoHideMs);
  expiryTimers.set(id, timer);
  return id;
}

export function removeAdminToast(id: string) {
  const entry = toasts.find((t) => t.id === id);
  if (!entry) return;
  const timer = expiryTimers.get(id);
  if (timer) {
    window.clearTimeout(timer);
    expiryTimers.delete(id);
  }
  toasts = toasts.filter((t) => t.id !== id);
  emit();
  entry.onDismiss?.();
}

function adminToastRoot(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  let el = document.getElementById(ADMIN_TOAST_ROOT_ID);
  if (!el) {
    el = document.createElement('div');
    el.id = ADMIN_TOAST_ROOT_ID;
    el.className =
      'fixed top-[calc(var(--admin-header-h,62px)+12px)] sm:top-[calc(var(--admin-header-h,66px)+12px)] right-3 sm:right-5 z-[60] flex flex-col gap-2.5 pointer-events-none w-[min(calc(100vw-1.5rem),380px)]';
    document.body.appendChild(el);
  }
  return el;
}

function AdminToastItem({
  entry,
}: {
  entry: ToastEntry;
}) {
  const type = normalizeAdminAlertType(entry.message.type);
  const canDismiss = entry.message.dismissible !== false;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 48, scale: 0.98 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 48, scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 420, damping: 32 }}
      className={`pointer-events-auto flex items-start gap-2.5 rounded-xl border px-4 py-3 shadow-lg text-[13.5px] font-medium leading-snug backdrop-blur-sm ${ALERT_CLS[type]}`}
      role="status"
      aria-live="polite"
    >
      {ALERT_ICON[type]}
      <p className="flex-1 min-w-0 pt-0.5">{entry.message.text}</p>
      {canDismiss && (
        <button
          type="button"
          onClick={() => removeAdminToast(entry.id)}
          className="shrink-0 -mr-1 -mt-0.5 p-1 rounded-md opacity-70 hover:opacity-100 hover:bg-black/5 transition"
          aria-label={translations[detectLang()].liveMonitorClose}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </motion.div>
  );
}

/** Admin panelda doimiy toast qatlami — sahifa o'zgarganda ham yoniq qoladi. */
export function AdminToastLayer() {
  const entries = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const [root, setRoot] = React.useState<HTMLElement | null>(null);

  useEffect(() => {
    setRoot(adminToastRoot());
  }, []);

  if (!root || !entries.length) return null;

  return createPortal(
    <AnimatePresence mode="popLayout">
      {entries.map((entry) => (
        <AdminToastItem key={entry.id} entry={entry} />
      ))}
    </AnimatePresence>,
    root,
  );
}
