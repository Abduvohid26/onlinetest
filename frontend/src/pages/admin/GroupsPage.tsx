import React, { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
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
  const [msg, setMsg] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  // Inline edit state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');

  // Inline delete confirm state
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [deleteForcing, setDeleteForcing] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

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
    if (!filterLevelId) { setMsg({ type: 'error', text: t.emptyLevels }); return; }
    setSaving(true);
    setMsg(null);
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
    if (res.ok) {
      setNewGroupName('');
      setMsg({ type: 'success', text: t.groupAddedOk });
      reload();
    } else {
      const d = await readJsonSafe<{ error?: string }>(res);
      setMsg({ type: 'error', text: d?.error || t.errorGeneric });
    }
  };

  const startEdit = (g: Group) => {
    setEditingId(g.id);
    setEditName(g.name);
    setEditError('');
    setDeleteConfirmId(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName('');
    setEditError('');
  };

  const saveEdit = async (id: number) => {
    if (!editName.trim()) return;
    setEditSaving(true);
    setEditError('');
    const res = await fetch(apiUrl(`/api/admin/groups/${id}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...h },
      body: JSON.stringify({ name: editName.trim() }),
    });
    setEditSaving(false);
    if (res.ok) {
      setEditingId(null);
      reload();
    } else {
      const d = await readJsonSafe<{ error?: string }>(res);
      setEditError(d?.error || t.errorGeneric);
    }
  };

  const requestDelete = (id: number) => {
    setDeleteConfirmId(id);
    setDeleteForcing(false);
    setEditingId(null);
  };

  const deleteGroup = async (id: number, force = false) => {
    setDeletingId(id);
    const res = await fetch(apiUrl(`/api/admin/groups/${id}`), {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', ...h },
      body: JSON.stringify({ force }),
    });
    setDeletingId(null);
    if (!res.ok) {
      const d = await readJsonSafe<{ error?: string; requires_force?: boolean }>(res);
      if (d?.requires_force) {
        setDeleteForcing(true);
        return;
      }
      setMsg({ type: 'error', text: d?.error || t.errorGeneric });
      setDeleteConfirmId(null);
    } else {
      setDeleteConfirmId(null);
      reload();
    }
  };

  const selectedLevel = levels.find((l) => String(l.id) === filterLevelId);
  const filtered = filterLevelId ? groups.filter((g) => String(g.level_id) === filterLevelId) : groups;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[360px_1fr] gap-5 items-start">

      {/* ── Guruh qo'shish ── */}
      <AdminCard
        icon={<PlusIcon />}
        title={t.kontingentAddGroup}
        subtitle={lang === 'ru' ? 'Добавить группу к уровню' : lang === 'en' ? 'Add a group to a level' : 'Darajaga guruh qo\'shish'}
      >
        <div className="px-5 py-4 space-y-4">
          <AnimatePresence mode="wait">
            {msg && (
              <motion.div key={msg.type + msg.text} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <AdminAlert type={msg.type}>{msg.text}</AdminAlert>
              </motion.div>
            )}
          </AnimatePresence>
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
            <AdminBtn type="submit" variant="blue" size="lg" loading={saving} icon={<PlusIcon size={16} />} className="w-full">
              {t.groupAddBtn}
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
          ) : filtered.map((g, i) => {
            const isEditing = editingId === g.id;
            const isDeleteConfirm = deleteConfirmId === g.id;
            const sc = g.student_count ?? 0;

            return (
              <motion.div key={g.id} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
                <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 px-4 sm:px-5 py-3 sm:py-4 transition-colors ${isEditing || isDeleteConfirm ? 'bg-gray-50/80' : 'hover:bg-gray-50'}`}>
                  <div className="w-9 h-9 rounded-lg bg-gray-100 text-gray-600 font-semibold flex items-center justify-center text-[15px] shrink-0">
                    {g.name.charAt(0).toUpperCase()}
                  </div>

                  {isEditing ? (
                    <div className="flex-1 min-w-0 flex items-center gap-2">
                      <AdminInput
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="flex-1"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveEdit(g.id);
                          if (e.key === 'Escape') cancelEdit();
                        }}
                      />
                      <AdminBtn variant="blue" size="sm" loading={editSaving} onClick={() => saveEdit(g.id)}>
                        {t.save}
                      </AdminBtn>
                      <AdminBtn variant="ghost" size="sm" onClick={cancelEdit}>
                        {t.cancel}
                      </AdminBtn>
                      {editError && <span className="text-[12px] text-red-600">{editError}</span>}
                    </div>
                  ) : (
                    <>
                      <div className="flex-1 min-w-[130px] min-w-0">
                        <p className="font-semibold text-gray-900 text-[14px] sm:text-[15px] truncate">{g.name}</p>
                        <p className="text-[12px] sm:text-[13px] text-gray-400 mt-0.5 truncate">
                          {g.level_name} · {g.program_track || 'bachelor'}
                          {g.academic_year != null ? ` · ${g.academic_year}-yil` : ''}
                          {sc > 0 && (
                            <span className="ml-2 font-medium text-indigo-600">{sc} {t.kontingentStudents}</span>
                          )}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <AdminBtn variant="violet" size="sm" onClick={() => onViewStudents(g)}
                          icon={<ChevronRight className="w-3.5 h-3.5 sm:hidden" />}>
                          <span className="hidden sm:inline">{t.kontingentStudents}</span>
                        </AdminBtn>
                        <AdminBtn variant="ghost" size="sm" onClick={() => startEdit(g)}
                          icon={<svg className="w-3.5 h-3.5 sm:hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>}>
                          <span className="hidden sm:inline">{t.edit}</span>
                        </AdminBtn>
                        <AdminBtn variant="red-ghost" size="sm" onClick={() => requestDelete(g.id)}
                          icon={<svg className="w-3.5 h-3.5 sm:hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>}>
                          <span className="hidden sm:inline">{t.delete}</span>
                        </AdminBtn>
                      </div>
                    </>
                  )}
                </div>

                {/* ── Delete confirmation inline ── */}
                <AnimatePresence>
                  {isDeleteConfirm && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="mx-5 mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
                        {deleteForcing ? (
                          <>
                            <p className="text-[13px] font-semibold text-red-700 flex items-center gap-2 mb-1">
                              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                              </svg>
                              {sc > 0
                                ? t.groupHasStudents.replace('{n}', String(sc))
                                : t.groupDeleteConfirm.replace('{name}', g.name)}
                            </p>
                            <div className="flex gap-2 mt-3">
                              <AdminBtn variant="red" size="sm" loading={deletingId === g.id} onClick={() => deleteGroup(g.id, true)}>
                                {t.groupDeleteForce}
                              </AdminBtn>
                              <AdminBtn variant="ghost" size="sm" onClick={() => { setDeleteConfirmId(null); setDeleteForcing(false); }}>
                                {t.cancel}
                              </AdminBtn>
                            </div>
                          </>
                        ) : (
                          <>
                            <p className="text-[13px] font-semibold text-red-700 mb-3">
                              {t.groupDeleteConfirm.replace('{name}', g.name)}
                            </p>
                            <div className="flex gap-2">
                              <AdminBtn variant="red" size="sm" loading={deletingId === g.id} onClick={() => deleteGroup(g.id, false)}>
                                {t.adminDeleteBtn}
                              </AdminBtn>
                              <AdminBtn variant="ghost" size="sm" onClick={() => setDeleteConfirmId(null)}>
                                {t.cancel}
                              </AdminBtn>
                            </div>
                          </>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>
      </AdminCard>
    </div>
  );
}
