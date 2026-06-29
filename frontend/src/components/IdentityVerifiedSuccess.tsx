import { motion } from 'motion/react';
import { Check } from 'lucide-react';

type Props = {
  title: string;
  subtitle?: string;
  scoreLabel?: string;
};

export function IdentityVerifiedSuccess({ title, subtitle, scoreLabel }: Props) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-emerald-950/55 backdrop-blur-[2px] pointer-events-none"
      aria-live="polite"
    >
      <div className="relative">
        <motion.span
          className="absolute inset-0 rounded-full bg-emerald-400/30"
          initial={{ scale: 0.6, opacity: 0.8 }}
          animate={{ scale: 2.2, opacity: 0 }}
          transition={{ duration: 1.1, ease: 'easeOut' }}
        />
        <motion.span
          className="absolute inset-0 rounded-full border-2 border-emerald-300/70"
          initial={{ scale: 1, opacity: 0.9 }}
          animate={{ scale: 1.55, opacity: 0 }}
          transition={{ duration: 0.9, ease: 'easeOut', delay: 0.05 }}
        />
        <motion.div
          initial={{ scale: 0, rotate: -18 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 420, damping: 22, delay: 0.08 }}
          className="relative flex h-24 w-24 sm:h-28 sm:w-28 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-green-600 shadow-[0_12px_40px_rgba(16,185,129,0.55)] ring-4 ring-white/90"
        >
          <motion.div
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{ delay: 0.22, duration: 0.35 }}
          >
            <Check className="h-12 w-12 sm:h-14 sm:w-14 text-white stroke-[3]" aria-hidden />
          </motion.div>
        </motion.div>
      </div>

      <motion.p
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.28, duration: 0.35 }}
        className="mt-5 text-lg sm:text-xl font-bold text-white drop-shadow-md text-center px-4"
      >
        {title}
      </motion.p>
      {subtitle ? (
        <motion.p
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.38, duration: 0.35 }}
          className="mt-1.5 text-sm text-emerald-100/95 text-center px-6 max-w-sm"
        >
          {subtitle}
        </motion.p>
      ) : null}
      {scoreLabel ? (
        <motion.span
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.48, duration: 0.3 }}
          className="mt-3 inline-flex items-center rounded-full bg-white/15 px-3 py-1 text-xs font-semibold text-emerald-50 border border-white/25"
        >
          {scoreLabel}
        </motion.span>
      ) : null}
    </motion.div>
  );
}
