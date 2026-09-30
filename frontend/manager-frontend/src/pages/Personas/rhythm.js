export const TIMEZONES = [
  { id: 'Europe/Kaliningrad', label: 'Калининград (UTC+2)' },
  { id: 'Europe/Moscow', label: 'Москва (UTC+3)' },
  { id: 'Europe/Samara', label: 'Самара (UTC+4)' },
  { id: 'Asia/Yekaterinburg', label: 'Екатеринбург (UTC+5)' },
  { id: 'Asia/Omsk', label: 'Омск (UTC+6)' },
  { id: 'Asia/Novosibirsk', label: 'Новосибирск (UTC+7)' },
  { id: 'Asia/Bangkok', label: 'Пхукет / Бангкок (UTC+7)' },
  { id: 'Asia/Krasnoyarsk', label: 'Красноярск (UTC+7)' },
  { id: 'Asia/Irkutsk', label: 'Иркутск (UTC+8)' },
  { id: 'Asia/Vladivostok', label: 'Владивосток (UTC+10)' },
  { id: 'Europe/Kiev', label: 'Киев (UTC+2/+3)' },
  { id: 'Asia/Almaty', label: 'Алматы (UTC+5)' },
  { id: 'Asia/Dubai', label: 'Дубай (UTC+4)' },
];

const range = (lo, hi, unit) => (lo === hi ? `${lo} ${unit}` : `${lo}–${hi} ${unit}`);

export function rhythmSummary(doc) {
  const d = doc || {};
  const parts = [];
  const rd = d.reply_delay || {};
  if (rd.enabled === false) parts.push('отвечает без задержки');
  else {
    parts.push(
      `первые ${rd.warmup_minutes ?? '?'} мин — ${range(rd.warmup_min_minutes, rd.warmup_max_minutes, 'мин')}, потом ${range(rd.min_minutes, rd.max_minutes, 'мин')}`,
    );
  }
  const as = d.after_silence || {};
  if (as.enabled !== false) parts.push(`после ${as.silence_hours ?? '?'} ч молчания — ${range(as.min_hours, as.max_hours, 'ч')}`);
  if (d.morning?.enabled !== false) parts.push(`утро ${d.morning?.from ?? '?'}–${d.morning?.to ?? '?'}`);
  if (d.goodnight?.enabled !== false) parts.push(`прощание ${d.goodnight?.from ?? '?'}–${d.goodnight?.to ?? '?'}`);
  return parts.join(' · ');
}
