export const PAUSE_REASON_SEP = ':';

export function pauseReasonHead(reason) {
  return String(reason ?? '').split(PAUSE_REASON_SEP, 1)[0];
}

export function pauseReasonDetail(reason) {
  const raw = String(reason ?? '');
  const cut = raw.indexOf(PAUSE_REASON_SEP);
  if (cut < 0) return null;
  return raw.slice(cut + PAUSE_REASON_SEP.length).trim() || null;
}

const LABELS = {
  bot_active: 'бот ведёт',
  human_takeover: 'на ручном',
  operator_hold: 'придержан менеджером',
  ceiling_halt: 'упор в потолок автономии',
  paused: 'пауза после отказа',
  persona_away: 'бот «отошёл» — вернётся сам по таймеру',
  archived: 'в архиве',
};

export function pauseReasonLabel(reason) {
  const head = pauseReasonHead(reason);
  return LABELS[head] ?? head;
}
