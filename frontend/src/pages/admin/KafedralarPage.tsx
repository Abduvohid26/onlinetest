import React, { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { translations, Language } from '../../i18n';
import { apiUrl } from '../../lib/apiUrl';
import { authHeaders } from '../../lib/uiLangHeader';
import { readJsonSafe, checkAdminAuthResponse } from '../../lib/http';
import {
  AdminInput, AdminField, AdminBtn, AdminCard,
  AdminEmpty, AdminPageMessage, PlusIcon,
} from './ui';
import type { Kafedra } from './types';

interface Props {
  token: string;
  lang: Language;
}

/** Kafedralar — Direction'ning tashkiliy ota-bo'g'ini (Kafedra -> Yo'nalish ->
 *  Guruh -> Talaba zanjiri). DirectionsPage bilan bir xil naqsh (CRUD, inline
 *  edit/delete), faqat qo'shimcha `code` maydoni bilan. */
export function KafedralarPage({ token, lang }: Props) {
  const t = translations[lang];
  const h = authHeaders(token, lang);

  const [kafedralar, setKafedralar] = useState<Kafedra[]>([]);
  const [newName, setNewName] = useState('');
  const [newCode, setNewCode] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editCode, setEditCode] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');

  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const reload = useCallback(async () => {
    const res = await fetch(apiUrl('/api/admin/kafedralar'), { headers: h });
    if (!checkAdminAuthResponse(res)) return;
    const j = await readJsonSafe<Kafedra[]>(res);
    setKafedralar(Array.isArray(j) ? j : []);
  }, [token]);

  useEffect(() => { reload(); }, [reload]);

  const addKafedra = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setSaving(true);
    setMsg(null);
    const res = await fetch(apiUrl('/api/admin/kafedralar'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...h },
      body: JSON.stringify({ name: newName.trim(), code: newCode.trim() || undefined }),
    });
    setSaving(false);
    if (!checkAdminAuthResponse(res)) return;
    if (res.ok) {
      setNewName('');
      setNewCode('');
      setMsg({ type: 'success', text: t.kafedraAddedOk });
      reload();
    } else {
      const d = await readJsonSafe<{ error?: string }>(res);
      setMsg({ type: 'error', text: d?.error || t.errorGeneric });
    }
  };

  const startEdit = (kf: Kafedra) => {
    setEditingId(kf.id);
    setEditName(kf.name);
    setEditCode(kf.code || '');
    setEditError('');
    setDeleteConfirmId(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName('');
    setEditCode('');
    setEditError('');
  };

  const saveEdit = async (id: number) => {
    if (!editName.trim()) return;
    setEditSaving(true);
    setEditError('');
    const res = await fetch(apiUrl(`/api/admin/kafedralar/${id}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...h },
      body: JSON.stringify({ name: editName.trim(), code: editCode.trim() || null }),
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

  const deleteKafedra = async (id: number) => {
    setDeletingId(id);
    const res = await fetch(apiUrl(`/api/admin/kafedralar/${id}`), {
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

        {/* ── Kafedra qo'shish ── */}
        <AdminCard
          icon={<PlusIcon />}
          title={t.kontingentAddKafedra}
          subtitle={t.kafedraSubtitle}
        >
          <div className="px-5 py-4 space-y-4">
            <form onSubmit={addKafedra} className="space-y-4">
              <AdminField label={t.kafedraLabel} required>
                <AdminInput
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder={t.kafedraPlaceholder}
                  required
                />
              </AdminField>
              <AdminField label={t.kafedraCodeLabel}>
                <AdminInput
                  value={newCode}
                  onChange={(e) => setNewCode(e.target.value)}
                  placeholder={t.kafedraCodePlaceholder}
                />
              </AdminField>
              <AdminBtn type="submit" variant="blue" size="lg" loading={saving} icon={<PlusIcon size={16} />} className="w-full">
                {t.kontingentAddKafedra}
              </AdminBtn>
            </form>
            <p className="text-[12px] text-gray-400 leading-relaxed border-t border-gray-100 pt-3">
              {t.kafedraHint}
            </p>
          </div>
        </AdminCard>

        {/* ── Kafedralar ro'yxati ── */}
        <AdminCard title={t.kontingentKafedralar} count={kafedralar.length}>
          <div className="divide-y divide-gray-100">
            {kafedralar.length === 0 ? (
              <AdminEmpty
                icon={<svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 6v-3a1 1 0 011-1h2a1 1 0 011 1v3" /></svg>}
                title={t.emptyKafedralar}
                subtitle={t.kafedraEmptyHint}
              />
            ) : kafedralar.map((kf, i) => {
              const isEditing = editingId === kf.id;
              const isDeleteConfirm = deleteConfirmId === kf.id;
              const dCount = kf.direction_count ?? 0;

              return (
                <motion.div key={kf.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
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
                            if (e.key === 'Enter') saveEdit(kf.id);
                            if (e.key === 'Escape') cancelEdit();
                          }}
                        />
                        <AdminInput
                          value={editCode}
                          onChange={(e) => setEditCode(e.target.value)}
                          placeholder={t.kafedraCodePlaceholder}
                          className="w-28"
                        />
                        <AdminBtn variant="blue" size="sm" loading={editSaving} onClick={() => saveEdit(kf.id)}>
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
                          <p className="font-semibold text-gray-900 text-[14px] sm:text-[15px] truncate">
                            {kf.name}
                            {kf.code ? <span className="ml-2 text-[12px] font-mono text-gray-400">{kf.code}</span> : null}
                          </p>
                          <p className="text-[12px] sm:text-[13px] text-gray-400 mt-0.5">{dCount} {t.kontingentDirections}</p>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <AdminBtn variant="ghost" size="sm" onClick={() => startEdit(kf)}
                            icon={<svg className="w-3.5 h-3.5 sm:hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>}>
                            <span className="hidden sm:inline">{t.edit}</span>
                          </AdminBtn>
                          <AdminBtn variant="red-ghost" size="sm" onClick={() => requestDelete(kf.id)}
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
                          {dCount > 0 ? (
                            <>
                              <p className="text-[13px] font-semibold text-red-700 flex items-center gap-2 mb-1">
                                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                </svg>
                                {t.kafedraHasDirections.replace('{n}', String(dCount))}
                              </p>
                              <AdminBtn variant="ghost" size="sm" onClick={() => setDeleteConfirmId(null)}>
                                {t.cancel}
                              </AdminBtn>
                            </>
                          ) : (
                            <>
                              <p className="text-[13px] font-semibold text-red-700 mb-3">
                                {t.kafedraDeleteConfirm.replace('{name}', kf.name)}
                              </p>
                              <div className="flex gap-2">
                                <AdminBtn variant="red" size="sm" loading={deletingId === kf.id} onClick={() => deleteKafedra(kf.id)}>
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
    </div>
  );
}
