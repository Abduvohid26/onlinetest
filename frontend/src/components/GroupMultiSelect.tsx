import React from 'react';
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

  const toggle = (id: number) => {
    if (selected.has(id)) {
      onChange(value.filter((x) => x !== id));
    } else {
      onChange([...value, id]);
    }
  };

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
        <div className="relative">
          <select
            multiple
            size={Math.min(8, Math.max(4, groups.length))}
            value={value.map(String)}
            onChange={(e) => {
              const ids = Array.from(e.target.selectedOptions).map((o) => Number(o.value));
              onChange(ids);
            }}
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-[14px] text-gray-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-violet-400/40 focus:border-violet-400"
            aria-label={t.selectGroups}
          >
            {groups.map((g) => (
              <option key={g.id} value={String(g.id)} className="py-1.5 rounded-lg">
                {g.name}
                {g.level_name ? ` — ${g.level_name}` : ''}
              </option>
            ))}
          </select>
          <p className="text-[11px] text-gray-400 mt-1.5">{t.selectGroupsCtrlHint}</p>
        </div>
      )}

      {groups.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {groups.map((g) => {
            const on = selected.has(g.id);
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => toggle(g.id)}
                className={`text-[12px] px-2.5 py-1 rounded-full border transition-colors ${
                  on
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'
                }`}
              >
                {g.name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
