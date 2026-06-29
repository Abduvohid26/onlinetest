import React from 'react';
import { AdminInput } from '../pages/admin/ui';
import { joinDatetimeLocal, splitDatetimeLocal } from '../lib/datetimeLocal';

type DateTimeFieldProps = {
  value: string;
  onChange: (value: string) => void;
  dateLabel: string;
  timeLabel: string;
  min?: string;
  defaultTime?: string;
  className?: string;
};

export function DateTimeField({
  value,
  onChange,
  dateLabel,
  timeLabel,
  min,
  defaultTime = '09:00',
  className,
}: DateTimeFieldProps) {
  const { date, time } = splitDatetimeLocal(value);
  const { date: minDate, time: minTime } = min ? splitDatetimeLocal(min) : { date: '', time: '' };
  const timeMin = date && minDate && date === minDate ? minTime : undefined;

  const update = (nextDate: string, nextTime: string) => {
    const d = nextDate || date;
    const tm = nextTime || time || defaultTime;
    if (d && tm) onChange(joinDatetimeLocal(d, tm));
    else if (d) onChange(joinDatetimeLocal(d, defaultTime));
    else onChange('');
  };

  return (
    <div className={`grid grid-cols-2 gap-2 ${className || ''}`}>
      <div>
        <label className="text-xs text-gray-500">{dateLabel}</label>
        <AdminInput
          type="date"
          value={date}
          min={minDate || undefined}
          onChange={(e) => update(e.target.value, time)}
          className="mt-0.5"
        />
      </div>
      <div>
        <label className="text-xs text-gray-500">{timeLabel}</label>
        <AdminInput
          type="time"
          value={time}
          min={timeMin}
          step={60}
          onChange={(e) => update(date, e.target.value)}
          className="mt-0.5"
        />
        <p className="text-[10px] text-gray-400 mt-1">24 soat (09:00 = tong, 21:00 = kech)</p>
      </div>
    </div>
  );
}
