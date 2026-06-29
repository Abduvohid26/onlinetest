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
  initialLevelId?: number | null;
  onViewStudents: (group: Group) => void;
}

export function GroupsPage({ token, lang, initialLevelId, onViewStudents }: Props) {
  const t = translations[lang];
  const h = { Authorization: `Bearer ${token}` };

  const [levels, setLevels] = useState<Level[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [filterLevelId, setFilterLevelId] = useState<string>(initialLevelId ? String(initialLevelId) : '');
  const [newGroupName, setNewGroupName] = useState('');
  const [newTrack, setNewTrack] = useState('bachelor');
  const [newYear, setNewYear] = useState('');
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [msg, setMsg] = useState('');

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
  useEffect(() => { if (initialLevelId) setFilterLevelId(String(initialLevelId)); }, [initialLevelId]);

  const addGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!filterLevelId) { setMsg(t.emptyLevels); return; }
    setSaving(true);
    const body: Record<string, unknown> = {
      name: newGroupName.trim(),
      level_id: Number(filterLevelId),
      program_track: newTrack,
    };
    if (newYear.trim()) body.academic_year = Number(newYear);
    const res = await fetch(apiUrl('/api/admin/groups'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...h },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (res.ok) { setNewGroupName(''); setMsg(''); reload(); }
    else { const d = await readJsonSafe<{ error?: string }>(res); setMsg(d?.error || t.errorGeneric); }
  };

  const deleteGroup = async (id: number) => {
    if (!confirm(lang === 'ru' ? 'Удалить группу?' : lang === 'en' ? 'Delete group?' : 'Guruhni o\'chirish?')) return;
    setDeletingId(id);
    await fetch(apiUrl(`/api/admin/groups/${id}`), { method: 'DELETE', headers: h });
    setDeletingId(null);
    reload();
  };

  const selectedLevel = levels.find((l) => String(l.id) === filterLevelId);
  const filtered = filterLevelId ? groups.filter((g) => String(g.level_id) === filterLevelId) : groups;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[380px_1fr] gap-5 items-start">

      {/* ── Guruh qo'shish ── */}
      <AdminCard
        icon={<PlusIcon />}
        iconBg="bg-violet-600"
        title={t.kontingentAddGroup}
        subtitle={lang === 'ru' ? 'Добавить группу к уровню' : lang === 'en' ? 'Add a group to a level' : 'Darajaga guruh qo\'shish'}
      >
        <div className="px-5 py-4 space-y-4">
          {msg && <AdminAlert type="error">{msg}</AdminAlert>}
          <form onSubmit={addGroup} className="space-y-4">
            <AdminField label={t.levelLabel} required>
              <AdminSelect value={filterLevelId} onChange={(e) => setFilterLevelId(e.target.value)} required>
                <option value="">{t.allLevels}</option>
                {levels.map((l) => <option key={l.id} value={String(l.id)}>{l.name}</option>)}
              </AdminSelect>
            </AdminField>
            <AdminField label={t.groupName} required>
              <AdminInput
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                required
                placeholder="A-guruh"
              />
            </AdminField>
            <div className="grid grid-cols-2 gap-3">
              <AdminField label={t.programTrack}>
                <AdminSelect value={newTrack} onChange={(e) => setNewTrack(e.target.value)}>
                  <option value="bachelor">bachelor</option>
                  <option value="residency">residency</option>
                  <option value="master">master</option>
                </AdminSelect>
              </AdminField>
              <AdminField label={t.academicYear}>
                <AdminInput
                  value={newYear}
                  onChange={(e) => setNewYear(e.target.value)}
                  placeholder="1–6"
                  type="number"
                  min={1}
                  max={6}
                />
              </AdminField>
            </div>
            <AdminBtn type="submit" variant="violet" size="lg" loading={saving} icon={<PlusIcon size={16} />} className="w-full">
              {lang === 'ru' ? 'Добавить группу' : lang === 'en' ? 'Add Group' : 'Guruh qo\'shish'}
            </AdminBtn>
          </form>
        </div>
      </AdminCard>

      {/* ── Guruhlar ro'yxati ── */}
      <AdminCard
        title={`${t.kontingentGroups}${selectedLevel ? ` — ${selectedLevel.name}` : ''}`}
        count={filtered.length}
        right={
          <AdminSelect
            value={filterLevelId}
            onChange={(e) => setFilterLevelId(e.target.value)}
            className="h-9 text-[13px] !w-[150px] shrink-0"
          >
            <option value="">{t.allLevels}</option>
            {levels.map((l) => <option key={l.id} value={String(l.id)}>{l.name}</option>)}
          </AdminSelect>
        }
      >
        <div className="divide-y divide-gray-100">
          {filtered.length === 0 ? (
            <AdminEmpty
              icon={<svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>}
              title={t.groupsEmpty}
            />
          ) : filtered.map((g, i) => (
            <motion.div key={g.id} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
              className="flex items-center gap-4 px-5 py-4 hover:bg-gray-50 transition-colors">
              <div className="w-9 h-9 rounded-lg bg-gray-100 text-gray-600 font-semibold flex items-center justify-center text-[15px] shrink-0">
                {g.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-900 text-[15px] truncate">{g.name}</p>
                <p className="text-[13px] text-gray-400 mt-0.5 truncate">
                  {g.level_name} · {g.program_track || 'bachelor'}
                  {g.academic_year != null ? ` · ${g.academic_year}-yil` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <AdminBtn variant="violet" size="sm" onClick={() => onViewStudents(g)} iconRight={<ChevronRight />}>
                  {t.kontingentStudents}
                </AdminBtn>
                <AdminBtn variant="red-ghost" size="sm" loading={deletingId === g.id} onClick={() => deleteGroup(g.id)}>
                  {t.delete}
                </AdminBtn>
              </div>
            </motion.div>
          ))}
        </div>
      </AdminCard>
    </div>
  );
}
