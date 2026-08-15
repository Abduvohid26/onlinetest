import React, { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { translations, Language } from '../../i18n';
import { apiUrl } from '../../lib/apiUrl';
import { authHeaders } from '../../lib/uiLangHeader';
import { readJsonSafe, checkAdminAuthResponse } from '../../lib/http';
import {
  AdminInput, AdminField, AdminBtn, AdminCard,
  AdminEmpty, AdminPageMessage, AdminPagination, usePagedList, PlusIcon,
} from './ui';
import type { Direction, Group, Kafedra } from './types';

interface Props {
  token: string;
  lang: Language;
}

/** Yo'nalishlar (fakultet) — Level (kurs) bilan mustaqil o'q. Guruh ikkalasiga ham
 *  bog'lanadi: "1-kurs / Davolash ishi / 101-guruh". Bu sahifa LevelsPage bilan
 *  bir xil naqsh (CRUD, inline edit/delete) — faqat entity nomi boshqa. */
export function DirectionsPage({ token, lang }: Props) {
  const t = translations[lang];
  const h = authHeaders(token, lang);

  const [directions, setDirections] = useState<Direction[]>([]);
  const directionPage = usePagedList(directions);
  const [groups, setGroups] = useState<Group[]>([]);
  const [kafedralar, setKafedralar] = useState<Kafedra[]>([]);
  const [newName, setNewName] = useState('');
  const [newKafedraIds, setNewKafedraIds] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editKafedraIds, setEditKafedraIds] = useState<number[]>([]);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');

  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const reload = useCallback(async () => {
    const [rD, rG, rK] = await Promise.all([
      fetch(apiUrl('/api/admin/directions'), { headers: h }),
      fetch(apiUrl('/api/admin/groups'), { headers: h }),
      fetch(apiUrl('/api/admin/kafedralar'), { headers: h }),
    ]);
    if (!checkAdminAuthResponse(rD) || !checkAdminAuthResponse(rG) || !checkAdminAuthResponse(rK)) return;
    const jD = await readJsonSafe<Direction[]>(rD);
    const jG = await readJsonSafe<Group[]>(rG);
    const jK = await readJsonSafe<Kafedra[]>(rK);
    setDirections(Array.isArray(jD) ? jD : []);
    setGroups(Array.isArray(jG) ? jG : []);
    setKafedralar(Array.isArray(jK) ? jK : []);
  }, [token]);

  useEffect(() => { reload(); }, [reload]);

  const toggleId = (ids: number[], id: number) => (
    ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]
  );

  const addDirection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setSaving(true);
    setMsg(null);
    const res = await fetch(apiUrl('/api/admin/directions'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...h },
      body: JSON.stringify({
        name: newName.trim(),
        kafedra_ids: newKafedraIds,
      }),
    });
    setSaving(false);
    if (!checkAdminAuthResponse(res)) return;
    if (res.ok) {
      setNewName('');
      setNewKafedraIds([]);
      setMsg({ type: 'success', text: t.directionAddedOk });
      reload();
    } else {
      const d = await readJsonSafe<{ error?: string }>(res);
      setMsg({ type: 'error', text: d?.error || t.errorGeneric });
    }
  };

  const startEdit = (dr: Direction) => {
    setEditingId(dr.id);
    setEditName(dr.name);
    setEditKafedraIds(dr.kafedra_ids?.length ? dr.kafedra_ids : (dr.kafedra_id ? [dr.kafedra_id] : []));
    setEditError('');
    setDeleteConfirmId(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName('');
    setEditKafedraIds([]);
    setEditError('');
  };

  const saveEdit = async (id: number) => {
    if (!editName.trim()) return;
    setEditSaving(true);
    setEditError('');
    const res = await fetch(apiUrl(`/api/admin/directions/${id}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...h },
      body: JSON.stringify({
        name: editName.trim(),
        kafedra_ids: editKafedraIds,
      }),
    });
    setEditSaving(false);
    if (!checkAdminAuthResponse(res)) return;
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
    setEditingId(null);
  };

  const deleteDirection = async (id: number) => {
    setDeletingId(id);
    const res = await fetch(apiUrl(`/api/admin/directions/${id}`), {
      method: 'DELETE',
      headers: h,
    });
    setDeletingId(null);
    setDeleteConfirmId(null);
    if (!checkAdminAuthResponse(res)) return;
    if (!res.ok) {
      const d = await readJsonSafe<{ error?: string }>(res);
      setMsg({ type: 'error', text: d?.error || t.errorGeneric });
    } else {
      reload();
    }
  };

  return (
    <div className="space-y-5">
      <AdminPageMessage message={msg} onDismiss={() => setMsg(null)} />
      <div className="grid grid-cols-1 xl:grid-cols-[360px_1fr] gap-5 items-start">

        {/* ── Yo'nalish qo'shish ── */}
        <AdminCard
          icon={<PlusIcon />}
          title={t.kontingentAddDirection}
          subtitle={t.directionSubtitle}
        >
          <div className="px-5 py-4 space-y-4">
            <form onSubmit={addDirection} className="space-y-4">
              <AdminField label={t.directionLabel} required>
                <AdminInput
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder={t.directionPlaceholder}
                  required
                />
              </AdminField>
              <AdminField label={t.directionKafedraLabel}>
                <div className="max-h-44 overflow-y-auto rounded-lg border border-gray-200 bg-white px-2 py-1.5 space-y-0.5">
                  {kafedralar.length === 0 ? (
                    <p className="text-[12px] text-gray-400 px-1 py-1">{t.directionKafedraNone}</p>
                  ) : kafedralar.map((kf) => (
                    <label key={kf.id} className="flex items-center gap-2 px-1 py-1 rounded hover:bg-gray-50 text-[13px] text-gray-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={newKafedraIds.includes(kf.id)}
                        onChange={() => setNewKafedraIds((prev) => toggleId(prev, kf.id))}
                      />
                      <span className="truncate">{kf.name}</span>
                    </label>
                  ))}
                </div>
              </AdminField>
              <AdminBtn type="submit" variant="blue" size="lg" loading={saving} icon={<PlusIcon size={16} />} className="w-full">
                {t.kontingentAddDirection}
              </AdminBtn>
            </form>
            <p className="text-[12px] text-gray-400 leading-relaxed border-t border-gray-100 pt-3">
              {t.directionHint}
            </p>
          </div>
        </AdminCard>

        {/* ── Yo'nalishlar ro'yxati ── */}
        <AdminCard title={t.kontingentDirections} count={directions.length}>
          <div className="divide-y divide-gray-100">
            {directions.length === 0 ? (
              <AdminEmpty
                icon={<svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 14l9-5-9-5-9 5 9 5zm0 0l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0112 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14zm-4 6v-7.5l4-2.222" /></svg>}
                title={t.emptyDirections}
                subtitle={t.directionEmptyHint}
              />
            ) : directionPage.pageItems.map((dr, i) => {
              const gCount = groups.filter((g) => g.direction_id === dr.id).length;
              const isEditing = editingId === dr.id;
              const isDeleteConfirm = deleteConfirmId === dr.id;

              return (
                <motion.div key={dr.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                  <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 px-4 sm:px-5 py-3 sm:py-4 transition-colors ${isEditing || isDeleteConfirm ? 'bg-gray-50/80' : 'hover:bg-gray-50'}`}>
                    <div className="w-9 h-9 rounded-lg bg-gray-100 text-gray-600 font-semibold flex items-center justify-center text-[15px] shrink-0 tabular-nums">
                      {i + 1}
                    </div>

                    {isEditing ? (
                      <div className="flex-1 min-w-0 flex flex-wrap items-center gap-2">
                        <AdminInput
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="flex-1 min-w-[140px]"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveEdit(dr.id);
                            if (e.key === 'Escape') cancelEdit();
                          }}
                        />
                        <div className="w-full max-h-36 overflow-y-auto rounded-lg border border-gray-200 bg-white px-2 py-1 space-y-0.5">
                          {kafedralar.map((kf) => (
                            <label key={kf.id} className="flex items-center gap-2 px-1 py-0.5 text-[12px] text-gray-700 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={editKafedraIds.includes(kf.id)}
                                onChange={() => setEditKafedraIds((prev) => toggleId(prev, kf.id))}
                              />
                              <span className="truncate">{kf.name}</span>
                            </label>
                          ))}
                        </div>
                        <AdminBtn variant="blue" size="sm" loading={editSaving} onClick={() => saveEdit(dr.id)}>
                          {t.save}
                        </AdminBtn>
                        <AdminBtn variant="ghost" size="sm" onClick={cancelEdit}>
                          {t.cancel}
                        </AdminBtn>
                        {editError && <span className="text-[12px] text-red-600 w-full">{editError}</span>}
                      </div>
                    ) : (
                      <>
                        <div className="flex-1 min-w-[130px] min-w-0">
                          <p className="font-semibold text-gray-900 text-[14px] sm:text-[15px] truncate">{dr.name}</p>
                          <p className="text-[12px] sm:text-[13px] text-gray-400 mt-0.5">
                            {(() => {
                              const names = dr.kafedra_names?.length
                                ? dr.kafedra_names.join(', ')
                                : (dr.kafedra_name || '');
                              return names ? `${names} · ${gCount} ${t.kontingentGroups}` : `${gCount} ${t.kontingentGroups}`;
                            })()}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <AdminBtn variant="ghost" size="sm" onClick={() => startEdit(dr)}
                            icon={<svg className="w-3.5 h-3.5 sm:hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>}>
                            <span className="hidden sm:inline">{t.edit}</span>
                          </AdminBtn>
                          <AdminBtn variant="red-ghost" size="sm" onClick={() => requestDelete(dr.id)}
                            icon={<svg className="w-3.5 h-3.5 sm:hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>}>
                            <span className="hidden sm:inline">{t.delete}</span>
                          </AdminBtn>
                        </div>
                      </>
                    )}
                  </div>

                  <AnimatePresence>
                    {isDeleteConfirm && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="mx-5 mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
                          {gCount > 0 ? (
                            <>
                              <p className="text-[13px] font-semibold text-red-700 flex items-center gap-2 mb-1">
                                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                </svg>
                                {t.directionHasGroups.replace('{n}', String(gCount))}
                              </p>
                              <AdminBtn variant="ghost" size="sm" onClick={() => setDeleteConfirmId(null)}>
                                {t.cancel}
                              </AdminBtn>
                            </>
                          ) : (
                            <>
                              <p className="text-[13px] font-semibold text-red-700 mb-3">
                                {t.directionDeleteConfirm.replace('{name}', dr.name)}
                              </p>
                              <div className="flex gap-2">
                                <AdminBtn variant="red" size="sm" loading={deletingId === dr.id} onClick={() => deleteDirection(dr.id)}>
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
          <AdminPagination
            page={directionPage.page}
            totalPages={directionPage.totalPages}
            onPageChange={directionPage.setPage}
            total={directionPage.total}
            pageSize={directionPage.pageSize}
          />
        </AdminCard>
      </div>
    </div>
  );
}
