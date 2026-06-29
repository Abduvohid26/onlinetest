import React, { useCallback, useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { translations, Language } from '../../i18n';
import { apiUrl } from '../../lib/apiUrl';
import { readJsonSafe, parseAdminUsersList } from '../../lib/http';
import { AdminInput, AdminBtn, AdminCard, AdminAlert, AdminEmpty, AdminLabel, AdminTextarea, AdminModal, AdminFileInput } from './ui';
import type { BanAppeal, Group, StudentRow } from './types';

interface Props { token: string; lang: Language; }

export function BannedPage({ token, lang }: Props) {
  const t = translations[lang];
  const h = { Authorization: `Bearer ${token}` };

  const [groups, setGroups] = useState<Group[]>([]);
  const [banList, setBanList] = useState<StudentRow[]>([]);
  const [appeals, setAppeals] = useState<BanAppeal[]>([]);
  const [reviewQueue, setReviewQueue] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [appealNotes, setAppealNotes] = useState<Record<number, string>>({});
  const [appealBusy, setAppealBusy] = useState<Record<number, boolean>>({});

  // Unban modal
  const [unbanUser, setUnbanUser] = useState<StudentRow | null>(null);
  const [unbanReason, setUnbanReason] = useState('');
  const [unbanFile, setUnbanFile] = useState<File | null>(null);
  const [unbanError, setUnbanError] = useState('');
  const [unbanBusy, setUnbanBusy] = useState(false);

  const load = useCallback(async () => {
    const [rG, rB, rA, rQ] = await Promise.all([
      fetch(apiUrl('/api/admin/groups'), { headers: h }),
      fetch(apiUrl('/api/admin/users?role=student&status=Banned'), { headers: h }),
      fetch(apiUrl('/api/admin/ban-appeals?status=Pending'), { headers: h }),
      fetch(apiUrl('/api/admin/review-queue?limit=40'), { headers: h }),
    ]);
    const jG = await readJsonSafe<Group[]>(rG);
    const jB = await readJsonSafe<unknown>(rB);
    const jA = await readJsonSafe<BanAppeal[]>(rA);
    const jQ = await readJsonSafe<{ results?: any[] }>(rQ);
    setGroups(Array.isArray(jG) ? jG : []);
    setBanList(parseAdminUsersList<StudentRow>(jB));
    setAppeals(Array.isArray(jA) ? jA : []);
    setReviewQueue(Array.isArray(jQ?.results) ? jQ!.results : []);
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const deleteUser = async (u: StudentRow) => {
    if (!confirm(t.userDeleteConfirm.replace('{name}', u.name).replace('{id}', u.id))) return;
    setDeletingId(u.id);
    await fetch(apiUrl(`/api/admin/users/${encodeURIComponent(u.id)}`), { method: 'DELETE', headers: h });
    setDeletingId(null);
    load();
  };

  const submitUnban = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!unbanUser || !unbanFile) return;
    if (unbanReason.trim().length < 8) { setUnbanError(lang === 'ru' ? 'Минимум 8 символов' : lang === 'en' ? 'At least 8 characters' : 'Kamida 8 ta belgi'); return; }
    setUnbanBusy(true); setUnbanError('');
    const fd = new FormData();
    fd.append('reason', unbanReason.trim());
    fd.append('evidence', unbanFile);
    const res = await fetch(apiUrl(`/api/admin/users/${encodeURIComponent(unbanUser.id)}/unban`), { method: 'POST', headers: h, body: fd });
    const d = await readJsonSafe<{ error?: string }>(res);
    setUnbanBusy(false);
    if (!res.ok) { setUnbanError(d?.error || t.errorGeneric); return; }
    setUnbanUser(null); setUnbanReason(''); setUnbanFile(null); setUnbanError('');
    load();
  };

  const resolveAppeal = async (id: number, decision: 'approve' | 'reject') => {
    const note = appealNotes[id] ?? '';
    if (decision === 'reject' && !note.trim()) return;
    setAppealBusy((p) => ({ ...p, [id]: true }));
    try {
      await fetch(apiUrl(`/api/admin/ban-appeals/${id}/resolve`), {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...h },
        body: JSON.stringify({ decision, note }),
      });
      setAppealNotes((p) => { const n = { ...p }; delete n[id]; return n; });
      load();
    } finally {
      setAppealBusy((p) => ({ ...p, [id]: false }));
    }
  };

  const filtered = banList.filter((u) => {
    const q = search.toLowerCase();
    return !q || u.name.toLowerCase().includes(q) || u.id.toLowerCase().includes(q);
  });

  return (
    <div className="space-y-5">
      {/* Bloklangan talabalar */}
      <AdminCard
        title={t.bannedUsers}
        subtitle={lang === 'ru' ? 'Для разблокировки нужны причина и файл-доказательство.' : lang === 'en' ? 'Unban requires a reason and evidence file.' : 'Bandan chiqarish uchun sabab va dalil fayl talab qilinadi.'}
        count={banList.length}
        borderColor="border-red-200/70"
        right={
          <AdminInput
            placeholder={t.searchByNameOrId}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 text-[13px] w-48 sm:w-64"
          />
        }
      >
        <div className="divide-y divide-gray-100">
          {filtered.length === 0 ? (
            <AdminEmpty
              icon={<svg className="w-8 h-8 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>}
              title={lang === 'ru' ? 'Заблокированных нет' : lang === 'en' ? 'No banned students' : 'Bloklangan talabalar yo\'q'}
            />
          ) : filtered.map((u, i) => (
            <motion.div key={u.id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }}
              className="flex items-center gap-4 px-5 py-4 hover:bg-red-50/20 transition-colors">
              <div className="w-10 h-10 rounded-xl bg-red-100 border border-red-200 flex items-center justify-center text-red-600 font-bold shrink-0 text-base">
                {u.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0 overflow-hidden">
                <p className="font-semibold text-gray-900 text-[15px] truncate">{u.name}</p>
                <p className="text-[13px] text-gray-400 truncate">{u.id} · {groups.find((g) => g.id === u.group_id)?.name || '—'}</p>
              </div>
              <div className="flex gap-2 shrink-0">
                <AdminBtn variant="emerald" size="sm" onClick={() => { setUnbanUser(u); setUnbanError(''); }}>
                  {t.unban}
                </AdminBtn>
                <AdminBtn variant="red-ghost" size="sm" loading={deletingId === u.id} onClick={() => deleteUser(u)}>
                  {t.delete}
                </AdminBtn>
              </div>
            </motion.div>
          ))}
        </div>
      </AdminCard>

      {/* Proctoring review queue */}
      <AdminCard title={t.reviewQueueTitle} count={reviewQueue.length} borderColor="border-indigo-200/60" headerBg="bg-indigo-50/30">
        <div className="px-5 py-4">
          {reviewQueue.length === 0 ? (
            <p className="text-[14px] text-indigo-400 py-2">{t.reviewQueueEmpty}</p>
          ) : (
            <div className="space-y-2 max-h-52 overflow-y-auto">
              {reviewQueue.slice(0, 10).map((q: any, idx: number) => (
                <div key={`${q.exam_id}-${q.student_id}-${idx}`}
                  className="text-[13px] px-3 py-2.5 rounded-xl bg-white border border-indigo-100 flex items-center justify-between gap-2">
                  <span className="truncate text-gray-700">{q.student_name} · {q.exam_title}</span>
                  <span className={`px-2 py-0.5 rounded-lg text-[12px] font-semibold shrink-0 ${q.sla_bucket === 'urgent' ? 'bg-red-100 text-red-700' : q.sla_bucket === 'high' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>
                    {q.sla_bucket}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </AdminCard>

      {/* Ban appeals */}
      <AdminCard title={t.pendingAppealsTitle} count={appeals.length} borderColor="border-amber-200/60" headerBg="bg-amber-50/30">
        <div className="px-5 py-4">
          {appeals.length === 0 ? (
            <p className="text-[14px] text-amber-500 py-2">{t.pendingAppealsEmpty}</p>
          ) : (
            <div className="space-y-4">
              {appeals.map((a) => {
                const note = appealNotes[a.id] ?? '';
                const busy = appealBusy[a.id] ?? false;
                return (
                  <div key={a.id} className="p-4 rounded-2xl border border-amber-200 bg-white space-y-3">
                    <div>
                      <p className="font-semibold text-gray-900 text-[15px]">{a.student_name} <span className="font-mono text-[13px] text-gray-400">({a.student_id})</span></p>
                      <p className="text-[13px] text-gray-500 mt-0.5">{a.exam_title || '—'} · {new Date(a.created_at).toLocaleString()}</p>
                    </div>
                    <p className="text-[14px] text-gray-700 border-l-2 border-amber-300 pl-3 whitespace-pre-wrap">{a.reason}</p>
                    <div className="space-y-2">
                      <AdminInput
                        placeholder={t.appealNoteOptional}
                        value={note}
                        onChange={(e) => setAppealNotes((p) => ({ ...p, [a.id]: e.target.value }))}
                        className="h-10 text-[14px]"
                      />
                      <div className="flex gap-2">
                        <AdminBtn variant="emerald" size="sm" disabled={busy} loading={busy} onClick={() => resolveAppeal(a.id, 'approve')} className="flex-1">
                          {t.appealApprove}
                        </AdminBtn>
                        <AdminBtn variant="red-ghost" size="sm" disabled={busy || !note.trim()} onClick={() => resolveAppeal(a.id, 'reject')} className="flex-1">
                          {t.appealReject}
                        </AdminBtn>
                      </div>
                      {!note.trim() && <p className="text-[12px] text-red-500">{t.appealNoteRequired}</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </AdminCard>

      {/* Unban modal */}
      <AdminModal
        open={!!unbanUser}
        onClose={() => setUnbanUser(null)}
        title={unbanUser ? `${t.unban} — ${unbanUser.name}` : ''}
        titleClassName="text-emerald-700"
      >
        {unbanUser && (
          <>
            {unbanError && <AdminAlert type="error">{unbanError}</AdminAlert>}
            <form onSubmit={submitUnban} className="space-y-4">
                <div>
                  <AdminLabel required>
                    {lang === 'ru' ? 'Причина разблокировки' : lang === 'en' ? 'Unban reason' : 'Bandan chiqarish sababi'}
                  </AdminLabel>
                  <AdminTextarea value={unbanReason} onChange={(e) => setUnbanReason(e.target.value)} required minLength={8} rows={3} className="min-h-[84px]" />
                  <p className="text-[12px] text-gray-400 mt-1">{unbanReason.length}/8 min</p>
                </div>
                <div>
                  <AdminLabel required>
                    {lang === 'ru' ? 'Файл-доказательство' : lang === 'en' ? 'Evidence file' : 'Dalil fayl'} (JPG/PDF)
                  </AdminLabel>
                  <AdminFileInput accept=".jpg,.jpeg,application/pdf,image/jpeg" required onChange={(e) => setUnbanFile(e.target.files?.[0] || null)} />
                </div>
                <div className="flex justify-end gap-3 pt-2">
                  <AdminBtn variant="ghost" onClick={() => setUnbanUser(null)}>{t.cancel}</AdminBtn>
                  <AdminBtn
                    type="submit"
                    variant="emerald"
                    loading={unbanBusy}
                    disabled={unbanBusy || unbanReason.trim().length < 8 || !unbanFile}
                  >
                    {t.unban}
                  </AdminBtn>
                </div>
            </form>
          </>
        )}
      </AdminModal>
    </div>
  );
}
