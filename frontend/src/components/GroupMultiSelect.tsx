import React, { useState } from 'react';
import { Language, translations } from '../i18n';

type Group = { id: number; name: string; level_name?: string };

export function GroupMultiSelect({
  groups,
  value,
  onChange,
  lang,
  onRefresh,
  emptyLabel,
}: {
  groups: Group[];
  value: number[];
  onChange: (ids: number[]) => void;
  lang: Language;
  onRefresh?: () => void;
  emptyLabel?: string;
}) {
  const t = translations[lang];
  const selected = new Set(value);
  const [picker, setPicker] = useState('');

  const available = groups.filter((g) => !selected.has(g.id));

  const addGroup = (raw: string) => {
    const id = Number(raw);
    if (!raw || Number.isNaN(id) || selected.has(id)) return;
    onChange([...value, id]);
    setPicker('');
  };

  const removeGroup = (id: number) => {
    onChange(value.filter((x) => x !== id));
  };

  const labelFor = (g: Group) => `${g.name}${g.level_name ? ` — ${g.level_name}` : ''}`;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12px] text-gray-500">{t.selectGroupsMultiHint}</p>
        <div className="flex items-center gap-2 shrink-0">
          {value.length > 0 && (
            <span className="text-[12px] font-semibold text-blue-600 bg-blue-100 px-2 py-0.5 rounded-full">
              {value.length} {t.groupsSelectedCount}
            </span>
          )}
          {onRefresh ? (
            <button
              type="button"
              onClick={onRefresh}
              className="text-[12px] text-blue-600 hover:text-blue-800 font-medium"
            >
              {t.refreshGroups}
            </button>
          ) : null}
        </div>
      </div>

      {groups.length === 0 ? (
        <p className="text-[13px] text-gray-400 text-center py-4 border border-gray-200 rounded-xl bg-gray-50/50">
          {emptyLabel || t.adminNoExamsYet}
        </p>
      ) : (
        <select
          value={picker}
          onChange={(e) => addGroup(e.target.value)}
          className="h-10 w-full rounded-lg border border-gray-200 bg-white px-3 pr-8 text-[14px] text-gray-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-violet-400/40 focus:border-violet-400 transition-colors cursor-pointer"
          aria-label={t.selectGroups}
        >
          <option value="">{available.length === 0 ? t.selectGroupsAllAdded : t.selectGroupsAdd}</option>
          {available.map((g) => (
            <option key={g.id} value={String(g.id)}>
              {labelFor(g)}
            </option>
          ))}
        </select>
      )}

      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {groups
            .filter((g) => selected.has(g.id))
            .map((g) => (
              <span
                key={g.id}
                className="inline-flex items-center gap-1.5 text-[12px] px-2.5 py-1 rounded-full border bg-blue-600 text-white border-blue-600"
              >
                {g.name}
                <button
                  type="button"
                  onClick={() => removeGroup(g.id)}
                  className="leading-none opacity-80 hover:opacity-100"
                  aria-label={g.name}
                >
                  ×
                </button>
              </span>
            ))}
        </div>
      )}
    </div>
  );
}
