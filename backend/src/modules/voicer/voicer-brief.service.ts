import { panelTime } from 'src/shared/panel-time';
import { Injectable, NotFoundException } from '@nestjs/common';
import { DashboardUser } from '@prisma/client';
import { PrismaService } from 'src/prisma.service';
import { ClockService } from 'src/shared/clock.service';
import {
  fillVariables,
  variableValues,
} from 'src/brain/nastya/config/variables';
import { VoicerChatService } from './voicer-chat.service';

const object = (v: any): Record<string, any> =>
  v && typeof v === 'object' && !Array.isArray(v) ? v : {};
const parse = (v: string | undefined) => {
  try {
    return object(JSON.parse(v || '{}'));
  } catch {
    return {};
  }
};
const list = (v: any): any[] => (Array.isArray(v) ? v : []);
const text = (v: any): string =>
  typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';
const labels: Record<string, string> = {
  name: 'Имя',
  age: 'Возраст',
  location: 'Город',
  current_location: 'Сейчас находится',
  city: 'Город',
  work: 'Работа',
  job: 'Работа',
  family: 'Семья',
  children: 'Дети',
  children_count: 'Количество детей',
  hobby: 'Увлечения',
  hobbies: 'Увлечения',
  interests: 'Интересы',
  likes: 'Нравится',
  dislikes: 'Не нравится',
  preferences: 'Предпочтения',
  relationships: 'Отношения',
  relationship_values: 'Что важно в отношениях',
  dating_site: 'Где познакомились',
  site: 'Где познакомились',
  pets: 'Животные',
  education: 'Образование',
  childhood: 'Детство',
  career: 'Работа и карьера',
  present: 'Сейчас',
  current: 'Сейчас',
  moscow_years: 'Жизнь в Москве',
  move_to_phuket: 'Переезд на Пхукет',
  move_to_madrid: 'Переезд в Мадрид',
  design_work: 'Дизайн',
  market_work: 'Работа на рынке',
  fitness_business: 'Фитнес-бизнес',
  return_plans: 'Планы возвращения',
  acquaintance: 'Знакомство',
  weekday: 'Будни',
  weekend: 'Выходные',
  home: 'Дом',
  friends: 'Друзья',
  cooking: 'Готовка',
  business: 'Бизнес',
  design: 'Дизайн',
  schedule: 'График',
  attitude: 'Отношение к работе',
  boundaries: 'Границы',
  opinions: 'Взгляды',
  public_label: 'О персонаже',
  origin: 'Предыстория',
  exchange: 'Биржа',
  travel: 'Путешествия',
  plans: 'Планы',
};
function lines(value: any, prefix = '', depth = 0): string[] {
  if (depth > 4) return [];
  if (text(value)) return [prefix ? `${prefix}: ${text(value)}` : text(value)];
  if (Array.isArray(value))
    return value.flatMap((v) => lines(v, prefix, depth + 1));
  return Object.entries(object(value))
    .filter(([k]) => !k.startsWith('_'))
    .flatMap(([k, v]) =>
      lines(v, labels[k] || k.replace(/_/g, ' '), depth + 1),
    );
}
export function personaBrief(persona: Record<string, any>) {
  return [
    ['Главное', persona.card],
    ['Биография', persona.biography],
    ['Работа', persona.work_and_income],
    ['Повседневная жизнь', persona.daily_life],
    ['Вкусы и интересы', persona.tastes],
    ['Отношения и ценности', persona.relationship_values],
    ['Манера общения', persona.voice],
  ]
    .map(([title, value]) => ({
      title: String(title),
      items: [...new Set(lines(value))],
    }))
    .filter((s) => s.items.length);
}
export function interlocutorBrief(
  state: Record<string, any>,
  facts: Record<string, any>,
  goals: Record<string, any>,
  excludedSources = new Set<number>(),
) {
  const character = object(state.character),
    slots = object(character.slots),
    cleared = new Set(list(character.cleared_slots));
  const rows: Array<{ label: string; value: string; source: string }> = [];
  const used = new Set<string>();
  const groups = [
    ['name'],
    ['age'],
    ['current_location', 'location', 'city'],
    ['work', 'job'],
    ['family'],
    ['children', 'children_count'],
    ['hobby', 'hobbies', 'interests'],
    ['likes'],
    ['dislikes'],
    ['preferences'],
    ['pets'],
    ['dating_site', 'site'],
  ];
  for (const keys of groups) {
    keys.forEach((k) => used.add(k));
    if (keys.some((k) => cleared.has(k))) continue;
    const slot = keys.find((k) => text(slots[k])),
      fact = keys.find((k) => text(facts[k]));
    const value = slot
      ? text(slots[slot])
      : fact
        ? text(facts[fact])
        : keys[0] === 'name'
          ? text(state.user_name)
          : '';
    if (value)
      rows.push({
        label: labels[keys[0]],
        value,
        source: slot
          ? 'Память диалога'
          : fact
            ? 'Карточка собеседника'
            : 'Память диалога',
      });
  }
  for (const slot of list(goals.slots)) {
    if (
      !slot ||
      used.has(slot.id) ||
      cleared.has(slot.id) ||
      !text(slots[slot.id])
    )
      continue;
    rows.push({
      label: labels[slot.id] || text(slot.topic) || slot.id.replace(/_/g, ' '),
      value: text(slots[slot.id]),
      source: 'Память диалога',
    });
  }
  const memories = list(state.memories)
    .filter(
      (m) =>
        m &&
        text(m.text) &&
        m.status === 'active' &&
        !m.slot_id &&
        !list(m.source_message_ids).some((id) => excludedSources.has(id)),
    )
    .sort(
      (a, b) =>
        Number(b.importance || 0) - Number(a.importance || 0) ||
        text(b.updated_on).localeCompare(text(a.updated_on)),
    );
  const memoryRows = (kinds: string[]) =>
    [
      ...new Map(
        memories
          .filter((m) => kinds.includes(m.kind))
          .map((m) => [
            text(m.text),
            {
              text: text(m.text),
              date: text(m.updated_on || m.created_on),
              source:
                m.source === 'operator'
                  ? 'Заметка менеджера'
                  : 'Сохранённая память',
            },
          ]),
      ).values(),
    ].slice(0, 20);
  return {
    fields: rows,
    preferences: memoryRows(['preference']),
    facts: memoryRows(['fact']),
    context: memoryRows(['episode', 'open_loop', 'shared_joke']),
    agreements: list(state.agreements).map(text).filter(Boolean).slice(-12),
  };
}

@Injectable()
export class VoicerBriefService {
  constructor(
    private prisma: PrismaService,
    private chats: VoicerChatService,
    private clock: ClockService,
  ) {}

  async get(user: DashboardUser, id: number) {
    const { task, contact } = await this.chats.context(user, id);
    if (task.kind !== 'call')
      throw new NotFoundException('Памятка доступна только для звонка');
    const [persona, pinned, brain] = await Promise.all([
      this.prisma.persona.findUnique({ where: { slug: task.personaSlug } }),
      contact
        ? this.prisma.leadFacts.findUnique({ where: { chatId: task.chatId! } })
        : null,
      contact
        ? this.prisma.brainState.findUnique({ where: { chatId: task.chatId! } })
        : null,
    ]);
    const facts = parse(pinned?.facts),
      state = parse(brain?.stateJson);
    const after = Number(object(state.history_reset).after_id) || 0;
    const sourceIds = [
      ...new Set<number>(
        list(state.memories)
          .flatMap((m) => list(m?.source_message_ids))
          .filter(Number.isSafeInteger),
      ),
    ];
    const [sources, recent] = contact
      ? await Promise.all([
          this.prisma.message.findMany({
            where: { chatId: task.chatId!, id: { in: sourceIds } },
            select: { id: true, deletedAt: true, editedAt: true },
          }),
          this.prisma.message.findMany({
            where: {
              chatId: task.chatId!,
              deletedAt: null,
              id: { gt: after },
              role: { in: ['user', 'assistant'] },
            },
            orderBy: [{ ts: 'desc' }, { id: 'desc' }],
            take: 6,
            select: {
              id: true,
              role: true,
              text: true,
              ts: true,
              author: true,
            },
          }),
        ])
      : [[], []];
    const valid = new Set(
      sources
        .filter((m) => !m.deletedAt && !m.editedAt && m.id > after)
        .map((m) => m.id),
    );
    const excluded = new Set(sourceIds.filter((id) => !valid.has(id)));
    const vars = Object.fromEntries(
      ['city', 'site', 'interlocutor_city']
        .filter((k) => typeof facts[k] === 'string')
        .map((k) => [k, facts[k]]),
    );
    const config = fillVariables(parse(persona?.persona), {
      ...variableValues(parse(persona?.variables)),
      ...vars,
      name: persona?.name || task.personaName,
    });
    await this.chats.context(user, id);
    return {
      task_id: id,
      generated_at: this.clock.ts(),
      memory_updated_at: brain?.updatedAt ?? null,
      persona: {
        name: persona?.name || task.personaName,
        sections: personaBrief(config),
        snapshot: task.biography,
      },
      interlocutor: {
        label: task.contactLabel,
        linked: Boolean(contact),
        ...interlocutorBrief(state, facts, parse(persona?.goals), excluded),
      },
      recent: recent.reverse().map((m) => ({
        id: m.id,
        text: m.text,
        ts: m.ts,
        speaker:
          m.role === 'user'
            ? 'Собеседник'
            : m.author.startsWith('operator')
              ? 'Менеджер от имени личности'
              : 'Личность',
      })),
      instructions: task.instructions,
      tempo: task.tempo,
      emotion: task.emotion,
    };
  }

  async forTelegram(user: DashboardUser, id: number) {
    const b = await this.get(user, id);
    const parts = [
      `ПАМЯТКА ДЛЯ ЗВОНКА #${id}`,
      `Личность: ${b.persona.name}`,
      ...b.persona.sections.flatMap((s) => [
        s.title,
        ...s.items.map((t) => `• ${t}`),
      ]),
      `СОБЕСЕДНИК: ${b.interlocutor.label}`,
      ...b.interlocutor.fields.map((f) => `${f.label}: ${f.value}`),
      ...[
        ['Предпочтения', b.interlocutor.preferences],
        ['Важные факты', b.interlocutor.facts],
        ['Что обсуждали', b.interlocutor.context],
      ].flatMap(([title, rows]: any) =>
        rows.length
          ? [
              title,
              ...rows.map((m) => `• ${m.text}${m.date ? ` (${m.date})` : ''}`),
            ]
          : [],
      ),
      ...b.interlocutor.agreements.map((t) => `Договорённость: ${t}`),
      ...(!b.interlocutor.linked
        ? ['Диалог не привязан — сведения о собеседнике недоступны.']
        : []),
      'Неуказанные сведения неизвестны. Сохранённые факты нужно сверять с последними сообщениями.',
      'ПОСЛЕДНИЕ СООБЩЕНИЯ',
      ...b.recent.map((m) => `${panelTime(m.ts)} · ${m.speaker}: ${m.text}`),
      `Тема: ${b.instructions}`,
      `Темп: ${b.tempo}`,
      `Эмоция: ${b.emotion}`,
      'ПОЛНАЯ КАРТОЧКА ПРИ СОЗДАНИИ ЗАДАНИЯ',
      b.persona.snapshot,
    ];
    return parts.join('\n\n');
  }
}
