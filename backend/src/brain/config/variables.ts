export const VARIABLE_NAME_RX = /^[\p{L}_][\p{L}\p{N}_]{0,39}$/u;
const PLACEHOLDER_RX = /\{([\p{L}_][\p{L}\p{N}_]{0,39})\}/gu;

export const BUILTIN_VARIABLES: Record<string, string> = {
  name: 'имя личности',
};

export const CHAT_VARIABLES: Record<string, string> = {
  city: 'закреплённый город легенды этого диалога',
  interlocutor_city: 'текущее местонахождение собеседника',
  site: 'сайт знакомств лида',
};

export function withoutChatVariables(
  vars: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(vars).filter(([key]) => !(key in CHAT_VARIABLES)),
  );
}

export function variablesNote(
  text: string,
  vars: Record<string, string>,
): string {
  const used = Object.keys(CHAT_VARIABLES).filter((key) =>
    text.includes(`{${key}}`),
  );
  if (!used.length) return '';
  const lines = used.map((key) =>
    vars[key]?.trim()
      ? `{${key}} = ${vars[key].trim()}`
      : `{${key}} — не известно (${CHAT_VARIABLES[key]}): не называй конкретное значение, обходи его`,
  );
  return (
    'ПЕРЕМЕННЫЕ ЭТОГО ДИАЛОГА — в тексте выше и в данных ниже читай так (в ответе пиши само значение, ' +
    `фигурные скобки не пиши никогда):\n${lines.join('\n')}`
  );
}

export function chatVariables(
  facts: Record<string, unknown> | null | undefined,
): Record<string, string> {
  const out: Record<string, string> = {
    interlocutor_city: typeof facts?.city === 'string' ? facts.city.trim() : '',
  };
  for (const key of Object.keys(CHAT_VARIABLES)) {
    const value =
      key === 'city'
        ? (facts?.['_persona_home_city'] ?? facts?.city)
        : facts?.[key];
    if (typeof value === 'string' && value.trim()) out[key] = value.trim();
  }
  return out;
}

const MAX_VARIABLES = 200;
const MAX_VALUE = 2000;

export function variableValues(doc: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return out;
  for (const [key, value] of Object.entries(doc as Record<string, unknown>)) {
    if (
      key.startsWith('_') ||
      !VARIABLE_NAME_RX.test(key) ||
      key in BUILTIN_VARIABLES
    )
      continue;
    if (typeof value === 'string') out[key] = value;
    else if (typeof value === 'number' || typeof value === 'boolean')
      out[key] = String(value);
  }
  return out;
}

export function placeholdersIn(text: string): string[] {
  return [...String(text ?? '').matchAll(PLACEHOLDER_RX)].map((m) => m[1]);
}

export function fillText(text: string, vars: Record<string, string>): string {
  return text.replace(PLACEHOLDER_RX, (whole, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : whole,
  );
}

export function fillVariables<T>(value: T, vars: Record<string, string>): T {
  if (!Object.keys(vars).length) return value;
  const walk = (node: unknown): unknown => {
    if (typeof node === 'string') return fillText(node, vars);
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') {
      return Object.fromEntries(
        Object.entries(node as Record<string, unknown>).map(([k, v]) => [
          k,
          walk(v),
        ]),
      );
    }
    return node;
  };
  return walk(value) as T;
}

export function variableErrors(doc: unknown): string[] {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc))
    return ['переменные — объект «имя: значение»'];
  const errors: string[] = [];
  const entries = Object.entries(doc as Record<string, unknown>);
  const names = entries.filter(([key]) => !key.startsWith('_'));
  if (names.length > MAX_VARIABLES)
    errors.push(`не больше ${MAX_VARIABLES} переменных`);
  for (const [key, value] of entries) {
    const name = key.startsWith('_') ? key.slice(1) : key;
    if (!VARIABLE_NAME_RX.test(name)) {
      errors.push(
        `«${key}»: имя из букв, цифр и «_», не с цифры, до 40 знаков`,
      );
      continue;
    }
    if (name in BUILTIN_VARIABLES && !key.startsWith('_')) {
      errors.push(
        `«{${name}}» встроенная — ${BUILTIN_VARIABLES[name]}, задать её нельзя`,
      );
      continue;
    }
    if (typeof value !== 'string') {
      errors.push(`«${key}»: значение — текст`);
      continue;
    }
    if (value.length > MAX_VALUE)
      errors.push(`«${key}»: не длиннее ${MAX_VALUE} знаков`);
  }
  return errors;
}
