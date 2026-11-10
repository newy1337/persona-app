import type { Slot } from 'src/brain/kernel/types';
import { goalName } from 'src/brain/character/progress';
import { fillVariables, variableValues } from 'src/brain/config/variables';

/** Личность из базы: её цели (slots) и переменные для подписей. */
export interface GoalPersonaRow {
  slug: string;
  name: string;
  goals: string;
  variables: string;
}

export interface GoalStatsRow {
  persona_id: string;
  name: string;
  /** диалогов, где бот уже разговаривал */
  chats: number;
  /** средняя доля узнанного по диалогам, 0–100 */
  percent: number;
  goals: Array<{
    id: string;
    title: string;
    topic: string | null;
    /** в скольких диалогах цель узнана */
    known: number;
    /** доля диалогов личности, 0–100 */
    percent: number;
  }>;
}

const json = (raw: string): Record<string, any> => {
  try {
    const v = JSON.parse(raw || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
};

const pct = (part: number, whole: number) =>
  whole ? Math.round((part / whole) * 1000) / 10 : 0;

/**
 * Цели по личностям: для каждой цели — в какой доле диалогов личности она
 * узнана. Считаются только цели из текущих настроек личности.
 */
export function goalStats(
  personas: GoalPersonaRow[],
  chats: Map<string, number>,
  known: Map<string, Map<string, number>>,
): GoalStatsRow[] {
  const bySlug = new Map(personas.map((p) => [p.slug, p]));
  const rows: GoalStatsRow[] = [];
  for (const [slug, total] of chats) {
    const persona = bySlug.get(slug);
    const vars = persona ? variableValues(json(persona.variables)) : {};
    const goals = fillVariables(json(persona?.goals ?? '{}'), vars);
    const slots = (Array.isArray(goals['slots']) ? goals['slots'] : []).filter(
      (s: Slot) => s && typeof s.id === 'string',
    ) as Slot[];
    const counts = known.get(slug) ?? new Map<string, number>();
    const list = slots.map((slot) => {
      const n = Math.min(counts.get(slot.id) ?? 0, total);
      return {
        id: slot.id,
        title: goalName(slot),
        topic: String((slot as any).topic ?? '').trim() || null,
        known: n,
        percent: pct(n, total),
      };
    });
    const sum = list.reduce((acc, g) => acc + g.known, 0);
    rows.push({
      persona_id: slug,
      name: persona?.name || slug,
      chats: total,
      percent: pct(sum, total * list.length),
      goals: list,
    });
  }
  return rows.sort((a, b) => b.chats - a.chats);
}
