import React, { useCallback, useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { translations, Language } from '../../i18n';
import { apiUrl } from '../../lib/apiUrl';
import { readJsonSafe, parseAdminUsersList } from '../../lib/http';
import {
  AdminInput, AdminField, AdminBtn, AdminCard,
  AdminEmpty, AdminAlert, PlusIcon,
} from './ui';
import type { StudentRow } from './types';

interface Props { token: string; lang: Language; }

export function StaffPage({ token, lang }: Props) {
  const t = translations[lang];
  const h = { Authorization: `Bearer ${token}` };

  const [staffList, setStaffList] = useState<StudentRow[]>([]);
  const [addMsg, setAddMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const res = await fetch(apiUrl('/api/admin/users?role=staff'), { headers: h });
    const j = await readJsonSafe<unknown>(res);
    setStaffList(parseAdminUsersList<StudentRow>(j));
  }, [token]);

  useEffect(() => { reload(); }, [reload]);

  const addStaff = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setAddMsg(null);
    const formEl = e.currentTarget;
    const fd = new FormData(formEl);
    const res = await fetch(apiUrl('/api/admin/users'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...h },
      body: JSON.stringify({ id: fd.get('id'), password: fd.get('password'), role: 'staff', name: fd.get('name'), group_id: null }),
    });
    const d = await readJsonSafe<{ error?: string }>(res);
    if (!res.ok) { setAddMsg({ type: 'err', text: d?.error || t.errorGeneric }); return; }
    formEl.reset();
    setAddMsg({ type: 'ok', text: t.hodimAddedOk });
    reload();
  };

  const deleteStaff = async (u: StudentRow) => {
    if (!confirm(t.userDeleteConfirm.replace('{name}', u.name).replace('{id}', u.id))) return;
    setDeletingId(u.id);
    await fetch(apiUrl(`/api/admin/users/${encodeURIComponent(u.id)}`), { method: 'DELETE', headers: h });
    setDeletingId(null);
    reload();
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[380px_1fr] gap-5 items-start">

      {/* ── Hodim qo'shish ── */}
      <AdminCard
        icon={<PlusIcon />}
        title={t.addHodimCardTitle}
        subtitle={t.staffPortalSubtitle}
      >
        <div className="px-5 py-4 space-y-4">
          {addMsg && <AdminAlert type={addMsg.type === 'ok' ? 'success' : 'error'}>{addMsg.text}</AdminAlert>}
          <form onSubmit={addStaff} className="space-y-4">
            <AdminField label="ID" required>
              <AdminInput name="id" required autoComplete="username" placeholder="staff001" />
            </AdminField>
            <AdminField label={t.userFullName} required>
              <AdminInput
                name="name"
                required
                placeholder={lang === 'ru' ? 'Иван Иванов' : lang === 'en' ? 'John Doe' : 'To\'liq ism'}
              />
            </AdminField>
            <AdminField label={t.password} required>
              <AdminInput
                name="password"
                type="password"
                required
                minLength={10}
                autoComplete="new-password"
                placeholder={lang === 'ru' ? 'мин. 10 символов' : lang === 'en' ? 'min. 10 chars' : 'kamida 10 belgi'}
              />
            </AdminField>
            <p className="text-[12px] text-gray-400">{t.addHodimHint}</p>
            <AdminBtn type="submit" variant="blue" size="lg" icon={<PlusIcon size={16} />} className="w-full">
              {t.addHodimCardTitle}
            </AdminBtn>
          </form>
        </div>
      </AdminCard>

      {/* ── Hodimlar ro'yxati ── */}
      <AdminCard title={t.kontingentStaffTab} count={staffList.length}>
        <div className="divide-y divide-gray-100">
          {staffList.length === 0 ? (
            <AdminEmpty
              icon={<svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6a4 4 0 11-8 0 4 4 0 018 0zM12 14v7" /></svg>}
              title={t.staffListEmpty}
            />
          ) : staffList.map((u, i) => (
            <motion.div key={u.id} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
              className="flex items-center gap-4 px-5 py-4 hover:bg-gray-50 transition-colors">
              <div className="w-9 h-9 rounded-lg bg-gray-100 text-gray-600 font-semibold flex items-center justify-center text-[15px] shrink-0">
                {u.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0 overflow-hidden">
                <p className="font-semibold text-gray-900 text-[15px] truncate">{u.name}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="font-mono text-[13px] text-gray-400 truncate">{u.id}</span>
                  <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold shrink-0 ${u.status === 'Active' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                    {u.status}
                  </span>
                </div>
              </div>
              <AdminBtn variant="red-ghost" size="sm" loading={deletingId === u.id} onClick={() => deleteStaff(u)}>
                {t.delete}
              </AdminBtn>
            </motion.div>
          ))}
        </div>
      </AdminCard>
    </div>
  );
}
