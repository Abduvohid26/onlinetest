import React, { useCallback, useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { translations, Language } from '../../i18n';
import { apiUrl } from '../../lib/apiUrl';
import { readJsonSafe } from '../../lib/http';
import {
  AdminInput, AdminSelect, AdminField, AdminBtn, AdminCard,
  AdminEmpty, AdminAlert, ChevronRight, PlusIcon,
} from './ui';
import type { Level, Group } from './types';

interface Props {
  token: string;
  lang: Language;
  onViewGroups: (level: Level) => void;
}


export function LevelsPage({ token, lang, onViewGroups }: Props) {
  const t = translations[lang];
  const h = { Authorization: `Bearer ${token}` };

  const [levels, setLevels] = useState<Level[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [adminForm, setAdminForm] = useState({ id: '', name: '', password: '' });
  const [adminMsg, setAdminMsg] = useState('');
  const [adminSaving, setAdminSaving] = useState(false);

  const reload = useCallback(async () => {
    const [rL, rG] = await Promise.all([
      fetch(apiUrl('/api/admin/levels'), { headers: h }),
      fetch(apiUrl('/api/admin/groups'), { headers: h }),
    ]);
    const jL = await readJsonSafe<Level[]>(rL);
    const jG = await readJsonSafe<Group[]>(rG);
    setLevels(Array.isArray(jL) ? jL : []);
    setGroups(Array.isArray(jG) ? jG : []);
  }, [token]);

  useEffect(() => { reload(); }, [reload]);

  const addLevel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setSaving(true);
    const res = await fetch(apiUrl('/api/admin/levels'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...h },
      body: JSON.stringify({ name: newName.trim() }),
    });
    setSaving(false);
    if (res.ok) { setNewName(''); setMsg(''); reload(); }
    else { const d = await readJsonSafe<{ error?: string }>(res); setMsg(d?.error || t.errorGeneric); }
  };

  const deleteLevel = async (id: number) => {
    if (!confirm(lang === 'ru' ? 'Удалить уровень?' : lang === 'en' ? 'Delete level?' : 'Darajani o\'chirish?')) return;
    setDeletingId(id);
    await fetch(apiUrl(`/api/admin/levels/${id}`), { method: 'DELETE', headers: h });
    setDeletingId(null);
    reload();
  };

  const addAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdminMsg('');
    setAdminSaving(true);
    const res = await fetch(apiUrl('/api/admin/users'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...h },
      body: JSON.stringify({
        id: adminForm.id, password: adminForm.password, role: 'admin',
        name: adminForm.name, group_id: null,
        profile_image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      }),
    });
    setAdminSaving(false);
    const d = await readJsonSafe<{ error?: string }>(res);
    if (res.ok) { setAdminForm({ id: '', name: '', password: '' }); setAdminMsg('ok'); }
    else setAdminMsg(d?.error || t.errorGeneric);
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 xl:grid-cols-[380px_1fr] gap-5 items-start">

        {/* ── Daraja qo'shish ── */}
        <AdminCard
          icon={<PlusIcon />}
          iconBg="bg-blue-600"
          title={t.kontingentAddLevel}
          subtitle={lang === 'ru' ? 'Курсы и ступени обучения' : lang === 'en' ? 'Academic courses / years' : 'O\'quv kurslari va bosqichlari'}
        >
          <div className="px-5 py-4 space-y-4">
            {msg && <AdminAlert type="error">{msg}</AdminAlert>}
            <form onSubmit={addLevel} className="space-y-4">
              <AdminField label={t.levelLabel} required>
                <AdminInput
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder={lang === 'ru' ? '1-й курс' : lang === 'en' ? '1st year' : '1-kurs'}
                  required
                />
              </AdminField>
              <AdminBtn
                type="submit"
                variant="blue"
                size="lg"
                loading={saving}
                icon={<PlusIcon size={16} />}
                className="w-full"
              >
                {lang === 'ru' ? 'Добавить уровень' : lang === 'en' ? 'Add Level' : 'Daraja qo\'shish'}
              </AdminBtn>
            </form>
            <p className="text-[12px] text-gray-400 leading-relaxed border-t border-gray-100 pt-3">
              {lang === 'ru' ? 'К каждому уровню можно добавить несколько групп.' : lang === 'en' ? 'Each level can have multiple groups.' : 'Har bir darajaga bir nechta guruh qo\'shish mumkin.'}
            </p>
          </div>
        </AdminCard>

        {/* ── Darajalar ro'yxati ── */}
        <AdminCard title={t.kontingentLevels} count={levels.length}>
          <div className="divide-y divide-gray-100">
            {levels.length === 0 ? (
              <AdminEmpty
                icon={<svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>}
                title={t.emptyLevels}
                subtitle={lang === 'ru' ? 'Добавьте первый уровень слева' : lang === 'en' ? 'Add your first level on the left' : 'Chap tomonda birinchi darajani qo\'shing'}
              />
            ) : levels.map((lv, i) => {
              const gCount = groups.filter((g) => g.level_id === lv.id).length;
              return (
                <motion.div key={lv.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
                  className="flex items-center gap-4 px-5 py-4 hover:bg-gray-50 transition-colors">
                  <div className="w-9 h-9 rounded-lg bg-gray-100 text-gray-600 font-semibold flex items-center justify-center text-[15px] shrink-0 tabular-nums">
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 text-[15px] truncate">{lv.name}</p>
                    <p className="text-[13px] text-gray-400 mt-0.5">{gCount} {t.kontingentGroups}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <AdminBtn variant="violet" size="sm" onClick={() => onViewGroups(lv)} iconRight={<ChevronRight />}>
                      {t.kontingentGroups}
                    </AdminBtn>
                    <AdminBtn variant="red-ghost" size="sm" loading={deletingId === lv.id} onClick={() => deleteLevel(lv.id)}>
                      {t.delete}
                    </AdminBtn>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </AdminCard>
      </div>

      {/* ── Admin yaratish ── */}
      <AdminCard
        icon={<svg style={{width:18,height:18}} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>}
        title={t.adminAddUserTitle}
        subtitle={lang === 'ru' ? 'Новый администратор получит полный доступ к системе' : lang === 'en' ? 'New admin will have full system access' : 'Yangi admin tizimga to\'liq kirish huquqiga ega bo\'ladi'}
      >
        <div className="px-5 py-5">
          {adminMsg && (
            <AdminAlert type={adminMsg === 'ok' ? 'success' : 'error'}>
              {adminMsg === 'ok'
                ? (lang === 'ru' ? '✓ Администратор успешно создан' : lang === 'en' ? '✓ Admin created successfully' : '✓ Admin muvaffaqiyatli yaratildi')
                : adminMsg}
            </AdminAlert>
          )}
          <form onSubmit={addAdmin} className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
            <AdminField label="ID" required>
              <AdminInput value={adminForm.id} onChange={(e) => setAdminForm((f) => ({ ...f, id: e.target.value }))} placeholder="admin001" required />
            </AdminField>
            <AdminField label={t.userFullName} required>
              <AdminInput
                value={adminForm.name}
                onChange={(e) => setAdminForm((f) => ({ ...f, name: e.target.value }))}
                placeholder={lang === 'ru' ? 'Иван Иванов' : lang === 'en' ? 'John Doe' : 'To\'liq ism'}
                required
              />
            </AdminField>
            <AdminField label={t.password} required>
              <AdminInput
                type="password"
                value={adminForm.password}
                onChange={(e) => setAdminForm((f) => ({ ...f, password: e.target.value }))}
                placeholder={lang === 'ru' ? 'мин. 10 символов' : lang === 'en' ? 'min. 10 chars' : 'kamida 10 belgi'}
                required
                minLength={10}
                autoComplete="new-password"
              />
            </AdminField>
            <AdminBtn
              type="submit"
              variant="amber"
              size="lg"
              loading={adminSaving}
              className="sm:col-span-3 sm:w-fit"
            >
              {lang === 'ru' ? 'Admin yaratish' : lang === 'en' ? 'Create Admin' : 'Admin yaratish'}
            </AdminBtn>
          </form>
        </div>
      </AdminCard>
    </div>
  );
}
