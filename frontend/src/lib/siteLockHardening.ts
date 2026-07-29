/**
 * Chrome ichida "Respondus darajasida" to'liq qulf imkonsiz, lekin imtihon
 * sessiyasida brauzer navigatsiyasi va ba'zi tizim tugmalarini qattiqlashtirish mumkin:
 *  - history trap (Back/Forward)
 *  - Keyboard Lock API (fullscreen ichida Escape va boshqalar — qo'llab-quvvatlansa)
 *  - qo'shimcha hotkey preventDefault (F5, Ctrl+R, Ctrl+L, …)
 *
 * Alt+Tab / boshqa monitor / telefon — brauzer API bilan BLOKLANMAYDI.
 */

export type SiteLockCleanup = () => void;

export interface SiteLockOptions {
  /** Orqaga/oldinga yoki manzil o'zgarishi urinishi */
  onNavigationAttempt?: () => void;
}

function tryKeyboardLock(): void {
  const kb = (navigator as Navigator & {
    keyboard?: { lock?: (keys?: string[]) => Promise<void>; unlock?: () => void };
  }).keyboard;
  if (!kb?.lock) return;
  // Bo'sh ro'yxat = barcha qo'llab-quvvatlanadigan tugmalar (Chrome).
  void kb.lock().catch(() => {
    /* ruxsat/fullscreen sharti bajarilmasa — jim */
  });
}

function tryKeyboardUnlock(): void {
  try {
    (navigator as Navigator & { keyboard?: { unlock?: () => void } }).keyboard?.unlock?.();
  } catch {
    /* ignore */
  }
}

/**
 * Imtihon ochiq bo'lganida chaqiring. Qaytgan funksiya — tozalash.
 */
export function installExamSiteLock(opts: SiteLockOptions = {}): SiteLockCleanup {
  const trap = () => {
    try {
      history.pushState({ examSiteLock: 1 }, '', location.href);
    } catch {
      /* ignore */
    }
  };

  // Dastlabki trap — Back bosilganda popstate keladi.
  trap();
  trap();

  const onPopState = () => {
    trap();
    opts.onNavigationAttempt?.();
  };
  window.addEventListener('popstate', onPopState);

  const onFullscreenChange = () => {
    if (document.fullscreenElement || (document as any).webkitFullscreenElement) {
      tryKeyboardLock();
    } else {
      tryKeyboardUnlock();
    }
  };
  document.addEventListener('fullscreenchange', onFullscreenChange);
  document.addEventListener('webkitfullscreenchange', onFullscreenChange as EventListener);
  onFullscreenChange();

  const onKeyDown = (e: KeyboardEvent) => {
    const key = (e.key || '').toLowerCase();
    const mod = e.ctrlKey || e.metaKey;

    // Yangilash / manzil paneli / yangi tab urinishlari (ba'zilari Chrome'da
    // baribir o'tishi mumkin — preventDefault best-effort).
    const block =
      key === 'f5' ||
      key === 'f11' ||
      (mod && ['r', 'l', 'h', 'd', 's', 'p', 'u', 'o'].includes(key)) ||
      (mod && e.shiftKey && ['r', 'i', 'j', 'c'].includes(key)) ||
      (e.altKey && (key === 'arrowleft' || key === 'arrowright' || key === 'home'));

    if (block) {
      e.preventDefault();
      e.stopPropagation();
      if (mod && key === 'l') opts.onNavigationAttempt?.();
      if (e.altKey && (key === 'arrowleft' || key === 'arrowright')) {
        opts.onNavigationAttempt?.();
      }
    }
  };
  window.addEventListener('keydown', onKeyDown, true);

  return () => {
    window.removeEventListener('popstate', onPopState);
    window.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('fullscreenchange', onFullscreenChange);
    document.removeEventListener('webkitfullscreenchange', onFullscreenChange as EventListener);
    tryKeyboardUnlock();
  };
}
