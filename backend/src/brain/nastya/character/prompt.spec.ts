import { buildCharacterPrompt } from './prompt';
import { DEFAULT_PROMPTS, mergePrompts, withName } from '../config/prompts';
import type { CharacterConfig, RuntimeSnapshot } from '../kernel/types';

const config = {
  persona: {
    name: 'Настя',
    identity: { public_label: 'девушка' },
    card: ['факт'],
    chat_examples: ['ОН: привет'],
  },
  day: {},
  goals: {},
  storylines: {},
} as unknown as CharacterConfig;

const runtime = {
  date: '2026-09-10',
  day: {},
  relationship: { turns: 3 },
  onboarding: { met_on_dating_site: 'beboo' },
  known_interlocutor: { name: 'Олег' },
  memories: [],
  agreements: [],
  deferred_slots: [],
  reply_rhythm: { kind: 'normal', guidance: '' },
  disclosure: {},
  storylines: [{ id: 'S1', current: 'стиралка' }],
} as unknown as RuntimeSnapshot;

describe('сборка промпта генератора', () => {
  const prompts = mergePrompts({});

  it('стабильная часть — личность и правила, изменяемая — ход', () => {
    const p = buildCharacterPrompt({
      config,
      runtime,
      judgment: { goal: 'share' },
      name: 'Настя',
      prompts,
    });
    expect(p.stable).toContain('Ты Настя');
    expect(p.stable).toContain('ПЕРСОНА');
    expect(p.stable).toContain(DEFAULT_PROMPTS.author_rules.slice(0, 40));
    expect(p.stable).not.toContain('КОНТЕКСТ');
    expect(p.volatile).toContain('КОНТЕКСТ');
    expect(p.volatile).toContain('РЕШЕНИЕ СКРЫТОГО СУДЬИ');
  });

  it('имя личности подставляется вместо {name}', () => {
    const p = buildCharacterPrompt({
      config,
      runtime,
      judgment: {},
      name: 'Лена',
      prompts,
    });
    expect(p.stable.startsWith('Ты Лена,')).toBe(true);
    expect(withName('я {name}, привет', 'Лена')).toBe('я Лена, привет');
  });

  it('свой текст личности вытесняет умолчание, пустой — нет', () => {
    const own = mergePrompts({ author_rules: 'Пиши коротко.', intro: '   ' });
    expect(own.author_rules).toBe('Пиши коротко.');
    expect(own.intro).toBe(DEFAULT_PROMPTS.intro);
    const p = buildCharacterPrompt({
      config,
      runtime,
      judgment: {},
      name: 'Настя',
      prompts: own,
    });
    expect(p.stable).toContain('Пиши коротко.');
    expect(p.stable).not.toContain(DEFAULT_PROMPTS.author_rules.slice(0, 40));
  });

  it('настройки собеседника идут в изменяемую часть, а не в кеш', () => {
    const p = buildCharacterPrompt({
      config,
      runtime,
      judgment: {},
      name: 'Настя',
      prompts,
      customInstructions: 'зовут его Пётр',
    });
    expect(p.volatile).toContain('зовут его Пётр');
    expect(p.stable).not.toContain('зовут его Пётр');
  });
});
