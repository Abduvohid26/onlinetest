import React, { useEffect, useState } from 'react';
import { translations, Language, type TranslationBundle } from '../../i18n';
import { apiUrl } from '../../lib/apiUrl';
import { authHeaders } from '../../lib/uiLangHeader';
import { readJsonSafe, checkAdminAuthResponse } from '../../lib/http';
import { AdminSectionLabel } from './ui';
import type { AdminStats } from './types';

type AdminPage = 'levels' | 'groups' | 'students' | 'banned' | 'staff' | 'exam_create' | 'exam_list';

const STAT_CARDS = (t: TranslationBundle, s: AdminStats) => [
  {
    label: t.totalUsers,
    value: s.totalUsers,
    page: 'students' as AdminPage,
    tone: 'neutral' as const,
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
  {
    label: t.totalExams,
    value: s.totalExams,
    page: 'exam_list' as AdminPage,
    tone: 'neutral' as const,
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    label: t.totalViolations,
    value: s.totalViolations,
    page: 'banned' as AdminPage,
    tone: 'warning' as const,
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
    ),
  },
  {
    label: t.bannedUsers,
    value: s.bannedUsers,
    page: 'banned' as AdminPage,
    tone: 'danger' as const,
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
      </svg>
    ),
  },
];

const QUICK_ACTIONS = (t: TranslationBundle) => [
  {
    label: t.sidebarLevelsSub,
    page: 'levels' as AdminPage,
    desc: t.quickActionLevelsDesc,
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
      </svg>
    ),
  },
  {
    label: t.sidebarGroupsSub,
    page: 'groups' as AdminPage,
    desc: t.quickActionGroupsDesc,
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
  {
    label: t.sidebarExamCreateSub,
    page: 'exam_create' as AdminPage,
    desc: t.quickActionExamCreateDesc,
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M12 4v16m8-8H4" />
      </svg>
    ),
  },
  {
    label: t.sidebarExamListSub,
    page: 'exam_list' as AdminPage,
    desc: t.quickActionExamListDesc,
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
      </svg>
    ),
  },
];

const GUIDE_STEPS = (t: TranslationBundle) => [
  { title: t.adminGuideStep1Title, body: t.adminGuideStep1Body, page: 'levels' as AdminPage },
  { title: t.adminGuideStep2Title, body: t.adminGuideStep2Body, page: 'exam_create' as AdminPage },
  { title: t.adminGuideStep3Title, body: t.adminGuideStep3Body, page: 'exam_create' as AdminPage },
  { title: t.adminGuideStep4Title, body: t.adminGuideStep4Body, page: 'exam_list' as AdminPage },
];

interface Props {
  token: string;
  lang: Language;
  onNavigate: (page: AdminPage) => void;
}

export function OverviewPage({ token, lang, onNavigate }: Props) {
  const t = translations[lang];
  const [stats, setStats] = useState<AdminStats>({ totalUsers: 0, totalExams: 0, totalViolations: 0, bannedUsers: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const res = await fetch(apiUrl('/api/admin/stats'), { headers: authHeaders(token, lang) });
      if (!checkAdminAuthResponse(res)) return;
      const j = await readJsonSafe<AdminStats>(res);
      if (j) setStats(j);
      setLoading(false);
    })();
  }, [token]);

  const cards = STAT_CARDS(t, stats);
  const quickActions = QUICK_ACTIONS(t);
  const guideSteps = GUIDE_STEPS(t);

  return (
    <div className="space-y-7">
      <section>
        <AdminSectionLabel>{t.overviewStatsSection}</AdminSectionLabel>
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
          {cards.map(({ label, value, icon, page, tone }) => {
            const alert = (tone === 'danger' || tone === 'warning') && value > 0;
            const numColor =
              tone === 'danger' && value > 0
                ? 'text-red-600'
                : tone === 'warning' && value > 0
                  ? 'text-amber-600'
                  : 'text-gray-900';
            return (
              <button
                key={label}
                type="button"
                onClick={() => onNavigate(page)}
                className="text-left p-4 rounded-lg border border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50/50 transition-colors group"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${alert ? (tone === 'danger' ? 'bg-red-50 text-red-500' : 'bg-amber-50 text-amber-500') : 'bg-gray-100 text-gray-500'}`}>
                    {icon}
                  </div>
                  <svg className="w-4 h-4 text-gray-300 group-hover:text-gray-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
                {loading ? (
                  <div className="h-8 w-16 bg-gray-100 animate-pulse rounded-md" />
                ) : (
                  <p className={`text-[28px] font-semibold leading-none tabular-nums ${numColor}`}>{value}</p>
                )}
                <p className="text-[13px] text-gray-500 mt-1.5 leading-tight">{label}</p>
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <AdminSectionLabel>{t.quickActions}</AdminSectionLabel>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          {quickActions.map(({ label, page, desc, icon }) => (
            <button
              key={page}
              type="button"
              onClick={() => onNavigate(page)}
              className="flex items-start gap-3 p-3.5 rounded-lg border border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50/50 transition-colors text-left group"
            >
              <div className="w-9 h-9 rounded-lg bg-gray-100 text-gray-500 flex items-center justify-center shrink-0 group-hover:bg-indigo-50 group-hover:text-indigo-600 transition-colors">
                {icon}
              </div>
              <div className="min-w-0">
                <p className="text-[13.5px] font-semibold text-gray-800 leading-tight">{label}</p>
                {desc && <p className="text-[12px] text-gray-400 mt-1 leading-snug">{desc}</p>}
              </div>
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-indigo-100 bg-gradient-to-br from-indigo-50/80 to-white p-5">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-indigo-600 text-white flex items-center justify-center shrink-0">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <p className="text-[15px] font-bold text-gray-900">{t.adminGuideTitle}</p>
              <span className="text-[11px] font-semibold uppercase tracking-wide bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-md">
                iMentor
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {guideSteps.map(({ title, body, page }) => (
                <button
                  key={title}
                  type="button"
                  onClick={() => onNavigate(page)}
                  className="text-left p-4 rounded-lg bg-white border border-gray-200 hover:border-indigo-200 hover:shadow-sm transition-all"
                >
                  <p className="text-[13.5px] font-semibold text-gray-900 mb-2">{title}</p>
                  <p className="text-[12.5px] text-gray-600 leading-relaxed">{body}</p>
                </button>
              ))}
            </div>
            <p className="text-[12px] text-indigo-800/90 mt-4 px-3 py-2 rounded-lg bg-indigo-50 border border-indigo-100">
              {t.adminGuideTip}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
