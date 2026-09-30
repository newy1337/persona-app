import { interlocutorBrief, personaBrief } from './voicer-brief.service';

describe('Call briefing from saved facts, without generated claims', () => {
  it('separates biography and preferences from prompts, examples and editorial metadata', () => {
    const b = personaBrief({
      card: ['Живёт на Пхукете'],
      biography: {
        education: 'Архитектор',
        family: 'Есть сестра',
        _internal: 'скрыто',
      },
      tastes: { likes: ['Море'], dislikes: ['Шум'] },
      prompts: 'не показывать',
      chat_examples: ['выдуманный разговор'],
    });
    expect(JSON.stringify(b)).toContain('Образование: Архитектор');
    expect(JSON.stringify(b)).toContain('Нравится: Море');
    expect(JSON.stringify(b)).not.toMatch(/скрыто|выдуманный|не показывать/);
  });
  it('uses corrected slots, respects removed facts, and leaves unknown values unknown', () => {
    const b = interlocutorBrief(
      {
        user_name: 'Старое имя',
        character: {
          slots: { name: 'Дима', location: 'Казань', coffee: 'Без сахара' },
          cleared_slots: ['age'],
        },
        memories: [
          {
            text: 'Любит горы',
            kind: 'preference',
            status: 'active',
            importance: 4,
          },
          {
            text: 'Старое предпочтение',
            kind: 'preference',
            status: 'resolved',
          },
          {
            text: 'Удалённый источник',
            kind: 'fact',
            status: 'active',
            source_message_ids: [7],
          },
        ],
        judge: { guidance: 'тайно' },
      },
      {
        name: 'Старое имя',
        age: 30,
        city: 'Москва',
        children_count: 0,
        _token: 'secret',
      },
      { slots: [{ id: 'coffee', topic: 'Кофе' }] },
      new Set([7]),
    );
    expect(b.fields).toEqual(
      expect.arrayContaining([
        { label: 'Имя', value: 'Дима', source: 'Память диалога' },
        {
          label: 'Сейчас находится',
          value: 'Казань',
          source: 'Память диалога',
        },
        { label: 'Дети', value: '0', source: 'Карточка собеседника' },
        { label: 'Кофе', value: 'Без сахара', source: 'Память диалога' },
      ]),
    );
    expect(b.preferences[0].text).toBe('Любит горы');
    expect(JSON.stringify(b)).not.toMatch(
      /Старое|Москва|Удалённый|тайно|secret|Возраст/,
    );
    expect(interlocutorBrief({}, {}, {}).fields).toEqual([]);
  });
});
