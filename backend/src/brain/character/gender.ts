export type Gender = 'female' | 'male';

const MALE_RX = /мужск|мужчин|(?<![а-яё])парень(?![а-яё])/iu;
const FEMALE_RX = /женск|женщин|девушк/iu;

export function personaGender(
  persona: Record<string, any> | null | undefined,
): Gender {
  const explicit = String(persona?.['gender'] ?? '')
    .trim()
    .toLowerCase();
  if (['male', 'm', 'м', 'муж', 'мужской'].includes(explicit)) return 'male';
  if (['female', 'f', 'ж', 'жен', 'женский'].includes(explicit))
    return 'female';
  const identity = persona?.['identity'];
  const candidates = [
    identity && typeof identity === 'object'
      ? String(identity['public_label'] ?? '')
      : typeof identity === 'string'
        ? identity
        : '',
    Array.isArray(persona?.['card']) ? String(persona!['card'][0] ?? '') : '',
  ];
  for (const text of candidates) {
    const male = MALE_RX.test(text);
    const female = FEMALE_RX.test(text);
    if (male && !female) return 'male';
    if (female && !male) return 'female';
  }
  return 'female';
}

export interface Voice {
  v(female: string, male: string): string;
  they: { he: string; him: string; to: string; about: string };
  c(male: string, female: string): string;
}

/**
 * Пол собеседника из карточки лида: m / f. Остальное — не указан: тогда
 * собеседник противоположного пола личности, как было всегда.
 */
export function clientGenderOf(raw: unknown): Gender | null {
  if (raw === 'f' || raw === 'female') return 'female';
  if (raw === 'm' || raw === 'male') return 'male';
  return null;
}

/** Строка для промпта: пол собеседника, когда его задали явно. */
export function interlocutorGenderNote(client: Gender): string {
  return client === 'female'
    ? 'Собеседник — женщина. Обращайся к ней в женском роде (ты пришла, ты сказала, ты права) и говори о ней «она». Не называй её мужчиной и не обращайся к ней в мужском роде, даже если инструкции личности написаны про собеседника-мужчину.'
    : 'Собеседник — мужчина. Обращайся к нему в мужском роде (ты пришёл, ты сказал, ты прав) и говори о нём «он». Не называй его женщиной и не обращайся к нему в женском роде, даже если инструкции личности написаны про собеседницу.';
}

/**
 * Голос личности и формы собеседника. Собеседник по умолчанию — противоположного
 * пола; client задаёт его явно (пол из карточки лида или поправленный менеджером).
 */
export function voiceOf(gender: Gender, client?: Gender | null): Voice {
  const male = gender === 'male';
  const clientFemale = client ? client === 'female' : male;
  return {
    v: (f, m) => (male ? m : f),
    they: clientFemale
      ? { he: 'она', him: 'её', to: 'ей', about: 'о ней' }
      : { he: 'он', him: 'его', to: 'ему', about: 'о нём' },
    c: (m, f) => (clientFemale ? f : m),
  };
}

export const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
