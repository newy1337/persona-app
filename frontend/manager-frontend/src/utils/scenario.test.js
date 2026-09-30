import { describe, it, expect } from 'vitest';
import {
  deliveredBy,
  findMessageIndex,
  searchMessages,
  goalRows,
  goalNow,
  nextActionLabel,
  groupByDay,
  dayProgress,
  humanFact,
  familyLabel,
  childrenWord,
  phoneLabel,
  shortTitle,
  leadChecklist,
  leadSignals,
  splitBeats,
  orderedBeats,
  outOfScopeBeats,
  manuallyClosedBeats,
  MANUAL_CLOSE_LABEL,
  stillPending,
  stageAtTs,
  stageLabel,
  isMediaEvidence,
  beatComment,
} from './scenario';

const EVENTS = [
  { event_type: 'stage_transition', metadata: { from: 'cold', to: 'rapport' }, ts: 100 },
  { event_type: 'message_in', metadata: {}, ts: 150 },
  { event_type: 'stage_transition', metadata: { from: 'rapport', to: 'pain' }, ts: 200 },
];

describe('stageAtTs — стадия на момент бита', () => {
  it('берёт последний переход НЕ ПОЗЖЕ ts', () => {
    expect(stageAtTs(EVENTS, 150)).toBe('rapport');
    expect(stageAtTs(EVENTS, 250)).toBe('pain');
    expect(stageAtTs(EVENTS, 200)).toBe('pain');
  });

  it('до первого перехода отдаёт исходную стадию этого перехода', () => {
    expect(stageAtTs(EVENTS, 50)).toBe('cold');
  });

  it('без переходов и без ts — null, а не догадка', () => {
    expect(stageAtTs([], 100)).toBeNull();
    expect(stageAtTs(EVENTS, null)).toBeNull();
    expect(stageAtTs(undefined, 100)).toBeNull();
  });

  it('не зависит от порядка событий во входе', () => {
    expect(stageAtTs([...EVENTS].reverse(), 150)).toBe('rapport');
  });
});

describe('leadChecklist — что известно и чего нет', () => {
  it('делит поля лид-карты на known/missing', () => {
    const { known, missing } = leadChecklist({ name: 'Артур', age: 40, job: 'other' });
    expect(known.map((f) => f.key)).toEqual(['name', 'age']);
    expect(missing.map((f) => f.key)).toEqual(['city', 'family']);
  });

  it('служебные ключи pinned_facts в чек-лист НЕ попадают', () => {
    const { known } = leadChecklist({
      name: 'Артур',
      funnel_stage: 'close',
      turns_in_current_stage: 228,
      vbros_phase: 'preamble',
    });
    expect(known.map((f) => f.key)).toEqual(['name']);
  });

  it('пустые значения считаются отсутствующими', () => {
    const { missing } = leadChecklist({ name: '', city: null });
    expect(missing.map((f) => f.key)).toContain('name');
    expect(missing.map((f) => f.key)).toContain('city');
    expect(missing.map((f) => f.key)).not.toContain('job');
  });
});

describe('leadSignals — на что реагировать', () => {
  it('читает реальные ключи боевой БД', () => {
    const s = leadSignals({
      pain_confirmed: true,
      pain_confirmed_turns: 2,
      income_is_vague: true,
      phone: 'commit_intent',
      turns_in_current_stage: 228,
    });
    expect(s.map((x) => x.key)).toEqual(['pain', 'stuck']);
    expect(s[0].text).toContain('2');
  });

  it('нет ключей — нет сигналов (пусто честнее выдуманного «всё хорошо»)', () => {
    expect(leadSignals({})).toEqual([]);
    expect(leadSignals(undefined)).toEqual([]);
  });

  it('короткая стадия не считается застреванием', () => {
    expect(leadSignals({ turns_in_current_stage: 3 }).map((x) => x.key)).toEqual([]);
  });
});

describe('splitBeats / deliveredBy', () => {
  const beats = [
    { id: 'B3', status: 'delivered', by: 'llm', src: 'judge' },
    { id: 'B2', status: 'unknown' },
    { id: 'B7', status: 'out_of_scope' },
    { id: 'B5', status: 'delivered', by: 'manager', actor: 'op1' },
  ];

  it('осталось и произнесено — раздельно, out_of_scope не показываем', () => {
    const { todo, done } = splitBeats(beats);
    expect(todo.map((b) => b.id)).toEqual(['B2']);
    expect(done.map((b) => b.id)).toEqual(['B3', 'B5']);
  });

  it('B1 не показывается вовсе: судья его часто не метит, а контакт очевиден', () => {
    const { todo, done } = splitBeats([
      { id: 'B1', status: 'unknown' },
      { id: 'B1', status: 'delivered', by: 'llm', src: 'judge' },
      { id: 'B2', status: 'unknown' },
    ]);
    expect([...todo, ...done].map((b) => b.id)).toEqual(['B2']);
  });

  it('кто зачёл: судья, событие, человек', () => {
    expect(deliveredBy(beats[0])).toBe('судья');
    expect(deliveredBy(beats[3])).toBe('менеджер op1');
    expect(deliveredBy({ status: 'delivered', by: 'llm', src: 'event' })).toBe('по событию');
    expect(deliveredBy(beats[1])).toBeNull();
  });
});

describe('orderedBeats — весь сценарий одним списком (решение 21.08)', () => {
  const B = (id, day, status = 'pending') => ({ id, title: `t-${id}`, day, status });

  it('измеряемые биты в порядке день → номер B (численно: B2 до B10)', () => {
    const out = orderedBeats([
      B('B10', 1),
      B('B20', 3, 'delivered'),
      B('B2', 1, 'delivered'),
      B('B12', 2),
      B('B3', 1),
    ]);
    expect(out.map((b) => b.id)).toEqual(['B2', 'B3', 'B10', 'B12', 'B20']);
  });

  it('out_of_scope и скрытый B1 выпадают, как в splitBeats', () => {
    const out = orderedBeats([B('B1', 1), B('B5', 1, 'out_of_scope'), B('B2', 1)]);
    expect(out.map((b) => b.id)).toEqual(['B2']);
  });

  it('бит без дня — группа 0, первой', () => {
    const out = orderedBeats([B('B2', 1), { id: 'B7', title: 'x', day: null }]);
    expect(out.map((b) => b.day ?? 0)).toEqual([0, 1]);
  });

  it('пустой вход — пустой список, а не падение', () => {
    expect(orderedBeats(undefined)).toEqual([]);
  });

  it('составной id встаёт рядом с родителем, а не в конец дня', () => {
    const out = orderedBeats([
      B('B30', 2),
      B('B26.text_feelings', 2),
      B('B26', 2),
      B('B26.media', 2),
    ]);
    expect(out.map((b) => b.id)).toEqual(['B26', 'B26.media', 'B26.text_feelings', 'B30']);
  });

  it('не-`B\\d` id — в конце дня НАМЕРЕННО, каждая форма поимённо', () => {
    const out = orderedBeats([
      B('C1_call_agreed', 2),
      B('BR4', 2),
      B('B26', 2),
      B('B26.media', 2),
    ]);
    expect(out.map((b) => b.id)).toEqual(['B26', 'B26.media', 'BR4', 'C1_call_agreed']);
  });

  it('строка без id (и без дня) — в группу 0, одинаковые id — порядок входа, падения нет', () => {
    const noId = { title: 'без id', status: 'pending' };
    const dupA = { ...B('B2', 1), title: 'первый' };
    const dupB = { ...B('B2', 1), title: 'второй' };
    const out = orderedBeats([noId, dupB, dupA]);
    expect(out.map((b) => b.title)).toEqual(['без id', 'второй', 'первый']);
  });

  it('день по-прежнему старше номера: B30 дня 1 идёт до B2 дня 2', () => {
    const out = orderedBeats([B('B2', 2), B('B30', 1)]);
    expect(out.map((b) => b.id)).toEqual(['B30', 'B2']);
  });
});

describe('outOfScopeBeats / manuallyClosedBeats — телеметрия вне знаменателя', () => {
  const B = (id, day, status = 'pending') => ({ id, title: `t-${id}`, day, status });

  it('в телеметрию идут ровно out_of_scope-строки', () => {
    const out = outOfScopeBeats([B('B2', 1), B('B5', 1, 'out_of_scope'), B('B7', 1, 'out_of_scope')]);
    expect(out.map((b) => b.id)).toEqual(['B5', 'B7']);
  });

  it('скрытый B1 в телеметрию не попадает даже как out_of_scope', () => {
    const out = outOfScopeBeats([B('B1', 1, 'out_of_scope'), B('B5', 1, 'out_of_scope')]);
    expect(out.map((b) => b.id)).toEqual(['B5']);
  });

  it('B1 — отдельная строка «закрыт вручную», а не «не отмечен»', () => {
    const out = manuallyClosedBeats([B('B1', 1), B('B2', 1), B('B5', 1, 'out_of_scope')]);
    expect(out.map((b) => b.id)).toEqual(['B1']);
    expect(MANUAL_CLOSE_LABEL).toBe('закрыт вручную');
  });

  it('пустой и битый вход — пустой список, а не падение', () => {
    expect(outOfScopeBeats(undefined)).toEqual([]);
    expect(outOfScopeBeats([])).toEqual([]);
    expect(outOfScopeBeats([null, undefined])).toEqual([]);
    expect(manuallyClosedBeats(undefined)).toEqual([]);
    expect(manuallyClosedBeats([null])).toEqual([]);
  });

  it('телеметрия и сценарий не пересекаются: строка либо там, либо там', () => {
    const beats = [B('B1', 1), B('B2', 1), B('B5', 1, 'out_of_scope')];
    const ids = [...orderedBeats(beats), ...outOfScopeBeats(beats), ...manuallyClosedBeats(beats)].map(
      (b) => b.id,
    );
    expect(ids.sort()).toEqual(['B1', 'B2', 'B5']);
  });

  it('телеметрия не трогает знаменатель дня: dayProgress тот же с out_of_scope и без', () => {
    const beats = [B('B2', 1, 'delivered'), B('B3', 1), B('B5', 1, 'out_of_scope')];
    expect(dayProgress(beats)).toEqual(dayProgress(beats.filter((b) => b.status !== 'out_of_scope')));
    expect(dayProgress(beats)).toEqual([{ day: 1, total: 2, delivered: 1 }]);
  });
});

describe('stageLabel', () => {
  it('переводит канонические стадии и пропускает незнакомые КАК ЕСТЬ', () => {
    expect(stageLabel('rapport')).toBe('сближение');
    expect(stageLabel('post_lead')).toBe('после лида');
    expect(stageLabel('нечто')).toBe('нечто');
    expect(stageLabel(null)).toBeNull();
  });
});

describe('humanFact — коды pinned_facts в человеческий текст', () => {
  it('переводит известные коды', () => {
    expect(humanFact('job', 'business')).toBe('бизнес');
    expect(humanFact('family', 'has_kids')).toBe('есть дети');
    expect(humanFact('phone', 'commit_intent')).toBe('готов дать');
    expect(humanFact('finances', 'finances_mentioned')).toBe('упоминал');
  });

  it('неизвестный код и свободный текст отдаёт КАК ЕСТЬ', () => {
    expect(humanFact('job', 'astronaut')).toBe('astronaut');
    expect(humanFact('name', 'Артур')).toBe('Артур');
    expect(humanFact('age', 40)).toBe('40');
  });
});

describe('childrenWord — склонение «ребёнок» при числе', () => {
  it('1 ребёнок · 2-4 ребёнка · 5+ детей', () => {
    expect(childrenWord(1)).toBe('ребёнок');
    expect(childrenWord(2)).toBe('ребёнка');
    expect(childrenWord(4)).toBe('ребёнка');
    expect(childrenWord(5)).toBe('детей');
    expect(childrenWord(9)).toBe('детей');
    expect(childrenWord(10)).toBe('детей');
  });

  it('🔴 11-14 — «детей» при ЛЮБОЙ последней цифре (иначе «12 ребёнка»)', () => {
    expect(childrenWord(11)).toBe('детей');
    expect(childrenWord(12)).toBe('детей');
    expect(childrenWord(13)).toBe('детей');
    expect(childrenWord(14)).toBe('детей');
  });

  it('после двадцати правило перезапускается по последней цифре', () => {
    expect(childrenWord(21)).toBe('ребёнок');
    expect(childrenWord(22)).toBe('ребёнка');
    expect(childrenWord(24)).toBe('ребёнка');
    expect(childrenWord(25)).toBe('детей');
  });

  it('сотни считаются по последним ДВУМ цифрам: 101 как 1, 111 как 11', () => {
    expect(childrenWord(101)).toBe('ребёнок');
    expect(childrenWord(102)).toBe('ребёнка');
    expect(childrenWord(111)).toBe('детей');
    expect(childrenWord(112)).toBe('детей');
  });
});

describe('familyLabel — количество детей вместо кода family (Д5)', () => {
  it('число детей вытесняет грубый код', () => {
    expect(familyLabel({ children_count: 2, family: 'has_kids' })).toBe('2 ребёнка');
    expect(familyLabel({ children_count: 1 })).toBe('1 ребёнок');
    expect(familyLabel({ children_count: 3 })).toBe('3 ребёнка');
    expect(familyLabel({ children_count: 5 })).toBe('5 детей');
    expect(familyLabel({ children_count: 12 })).toBe('12 детей');
    expect(familyLabel({ children_count: 21 })).toBe('21 ребёнок');
  });

  it('числа нет — прежнее поведение кода family, байт-в-байт', () => {
    expect(familyLabel({ family: 'has_kids' })).toBe('есть дети');
    expect(familyLabel({ family: 'divorced' })).toBe('в разводе');
    expect(familyLabel({ family: 'astronaut' })).toBe('astronaut');
  });

  it('пусто и мусор — null, зовущий рисует прочерк', () => {
    expect(familyLabel({})).toBeNull();
    expect(familyLabel(null)).toBeNull();
    expect(familyLabel({ children_count: 0 })).toBeNull();
    expect(familyLabel({ children_count: '2' })).toBeNull();
    expect(familyLabel({ children_count: 0, family: 'has_kids' })).toBe('есть дети');
  });

  it('имён и возраста детей в подписи НЕТ (PII, решение оператора 25.08)', () => {
    const label = familyLabel({ children_count: 2, _client_children: [{ name: 'Саша', age: 13 }] });
    expect(label).toBe('2 ребёнка');
    expect(label).not.toContain('Саша');
    expect(label).not.toContain('13');
  });
});

describe('shortTitle — короткое имя бита', () => {
  it('берёт заголовок до двоеточия', () => {
    expect(shortTitle('Поездки: Шанхай, Байкал и Ольхон, Аршан, Турция')).toBe('Поездки');
    expect(shortTitle('Обмен фото: свой кадр отправлен')).toBe('Обмен фото');
  });

  it('без двоеточия режет по границе СЛОВА, не посередине', () => {
    expect(shortTitle('Не курит, почти не пьёт, кофе только утром', 20)).toBe(
      'Не курит, почти не…',
    );
  });

  it('короткий заголовок не трогает и не добавляет многоточие', () => {
    expect(shortTitle('Обмен фото')).toBe('Обмен фото');
  });

  it('пустой вход — пустая строка, а не падение', () => {
    expect(shortTitle(null)).toBe('');
    expect(shortTitle('')).toBe('');
  });
});

describe('groupByDay', () => {
  it('группирует по дням в возрастающем порядке', () => {
    const g = groupByDay([
      { id: 'B14', day: 2 },
      { id: 'B1', day: 1 },
      { id: 'B23', day: 3 },
      { id: 'B2', day: 1 },
    ]);
    expect(g.map((x) => x.day)).toEqual([1, 2, 3]);
    expect(g[0].items.map((b) => b.id)).toEqual(['B1', 'B2']);
  });

  it('пустой вход — пустой список', () => {
    expect(groupByDay([])).toEqual([]);
    expect(groupByDay(undefined)).toEqual([]);
  });
});

describe('dayProgress — шкала сценария по дням воронки', () => {
  const BEATS = [
    { id: 'B1', day: 1, status: 'delivered' },
    { id: 'B2', day: 1, status: 'delivered' },
    { id: 'B3', day: 1, status: 'unknown' },
    { id: 'B7', day: null, status: 'out_of_scope' },
    { id: 'B13', day: 2, status: 'delivered' },
    { id: 'B14', day: 2, status: 'unknown' },
    { id: 'B23', day: 3, status: 'unknown' },
  ];

  it('дробь считается внутри дня, out_of_scope не идёт ни в один знаменатель', () => {
    expect(dayProgress(BEATS)).toEqual([
      { day: 1, total: 3, delivered: 2 },
      { day: 2, total: 2, delivered: 1 },
      { day: 3, total: 1, delivered: 0 },
    ]);
  });

  it('сумма дневных знаменателей равна общему знаменателю', () => {
    const measured = BEATS.filter((b) => b.status !== 'out_of_scope');
    const sum = dayProgress(BEATS).reduce((a, d) => a + d.total, 0);
    expect(sum).toBe(measured.length);
  });

  it('HIDDEN_BEATS не фильтруются: закрытый вручную B1 остаётся в знаменателе', () => {
    expect(dayProgress([
      { id: 'B1', day: 1, status: 'pending' },
      { id: 'B2', day: 1, status: 'delivered' },
    ])).toEqual([{ day: 1, total: 2, delivered: 1 }]);
  });

  it('бит без дня попадает в отдельную группу, а не в чей-то день', () => {
    const g = dayProgress([...BEATS, { id: 'BX', day: null, status: 'unknown' }]);
    expect(g[0]).toEqual({ day: 0, total: 1, delivered: 0 });
    expect(g.find((d) => d.day === 1)).toEqual({ day: 1, total: 3, delivered: 2 });
  });

  it('пустой вход — пустой список, а не нули', () => {
    expect(dayProgress([])).toEqual([]);
    expect(dayProgress(undefined)).toEqual([]);
  });
});

describe('goalRows — темы знакомства в строках чек-листа', () => {
  const goals = {
    stage: { id: 'knock', title: 'первое касание', index: 1, total: 5, turns: 4, days: 1 },
    known: 1,
    total: 4,
    next: { id: 'work', title: 'а работаешь где?' },
    slots: [
      { id: 'work', title: 'а работаешь где?', state: 'open', value: null, asks: 0, priority: 5, required_by_day: 1 },
      { id: 'age', title: 'сколько тебе лет?', state: 'asked', value: null, asks: 1, priority: 3, required_by_day: 1 },
      { id: 'family', title: 'семья есть?', state: 'deferred', value: null, asks: 1, priority: 7, required_by_day: 2 },
      { id: 'name', title: 'как тебя зовут?', state: 'known', value: 'Сергей', asks: 1, priority: 2, required_by_day: 1 },
    ],
  };

  it('состояния движка переводятся в значки чек-листа', () => {
    const by = Object.fromEntries(goalRows(goals).map((r) => [r.key, r]));
    expect(by.name.state).toBe('ok');
    expect(by.work.state).toBe('ask');
    expect(by.age.state).toBe('ask');
    expect(by.family.state).toBe('skip');
  });

  it('подпись строки — ответ собеседника, а не «узнали»', () => {
    const by = Object.fromEntries(goalRows(goals).map((r) => [r.key, r]));
    expect(by.name.note).toBe('Сергей');
    expect(by.work.note).toBe('не спрошена');
    expect(by.age.note).toBe('спросили 1 раз');
    expect(by.family.note).toContain('отложена');
  });

  it('значение едет в строку — его правят вручную', () => {
    const by = Object.fromEntries(goalRows(goals).map((r) => [r.key, r]));
    expect(by.name.value).toBe('Сергей');
    expect(by.work.value).toBeNull();
  });

  it('порядок и состав — с сервера: панель ничего не добавляет от себя', () => {
    expect(goalRows(goals).map((r) => r.key)).toEqual(['work', 'age', 'family', 'name']);
    expect(goalRows(null)).toEqual([]);
    expect(goalRows({})).toEqual([]);
  });
});

describe('nextActionLabel — что бот сделает дальше', () => {
  const NOW = 1_788_000_000;

  it('нет прогноза — подписи нет', () => {
    expect(nextActionLabel(null, NOW)).toBeNull();
    expect(nextActionLabel({}, NOW)).toBeNull();
  });

  it('ответ в очереди: через сколько и почему', () => {
    const l = nextActionLabel({ kind: 'reply', at: NOW + 12 * 60, reason: 'normal' }, NOW);
    expect(l.tone).toBe('ok');
    expect(l.text).toMatch(/^Ответит через 12 мин \(сегодня в \d\d:\d\d|^Ответит через 12 мин \(завтра в/);
    expect(l.text).toMatch(/обычная задержка$/);
    expect(nextActionLabel({ kind: 'reply', at: NOW + 2 * 3600 + 5 * 60, reason: 'after_silence' }, NOW, { short: true }).text).toBe('ответит через 2 ч 5 мин');
  });

  it('сам напишет утром / «куда пропал»', () => {
    expect(nextActionLabel({ kind: 'morning', at: NOW + 9 * 3600 }, NOW).text).toMatch(/^Бот напишет «доброе утро» (сегодня|завтра) в \d\d:\d\d \(через 9 ч\)/);
    expect(nextActionLabel({ kind: 'initiative', at: NOW + 3600 }, NOW).text).toMatch(/^Бот напишет первым — спросит, как дела/);
    expect(nextActionLabel({ kind: 'initiative', at: NOW + 90 * 60 }, NOW, { short: true }).text).toBe('напишет сам через 1 ч 30 мин');
  });

  it('минуты не доходят до 60: 2 ч 59,6 мин — это «через 3 ч»', () => {
    expect(nextActionLabel({ kind: 'initiative', at: NOW + 2 * 3600 + 59 * 60 + 36 }, NOW, { short: true }).text).toBe('напишет сам через 3 ч');
    expect(nextActionLabel({ kind: 'reply', at: NOW + 59 * 60 + 50, reason: 'normal' }, NOW, { short: true }).text).toBe('ответит через 1 ч');
  });

  it('ответ в работе — «пишет ответ», не тревога', () => {
    expect(nextActionLabel({ kind: 'composing' }, NOW)).toEqual({ tone: 'ok', text: 'Бот пишет ответ…' });
  });

  it('ждёт, ручной режим и ошибки — разными цветами', () => {
    expect(nextActionLabel({ kind: 'waiting' }, NOW).tone).toBe('wait');
    expect(nextActionLabel({ kind: 'manual' }, NOW, { short: true }).text).toBe('ручной режим');
    expect(nextActionLabel({ kind: 'no_reply', why: 'not_scheduled' }, NOW)).toMatchObject({ tone: 'warn', text: expect.stringMatching(/Ответить сейчас/) });
    expect(nextActionLabel({ kind: 'account_offline' }, NOW)).toMatchObject({ tone: 'warn', text: expect.stringMatching(/не в сети/) });
    expect(nextActionLabel({ kind: 'account_banned' }, NOW).text).toMatch(/заблокировал аккаунт/);
    expect(nextActionLabel({ kind: 'client_blocked' }, NOW, { short: true }).text).toBe('заблокировал нас');
    expect(nextActionLabel({ kind: 'account_logged_out' }, NOW).text).toMatch(/войдите/);
    expect(nextActionLabel({ kind: 'no_reply', why: 'expired' }, NOW, { short: true }).text).toBe('не ответит: старое');
  });
});

describe('goalNow — что бот поднимет следующим ходом', () => {
  it('тема из плана движка, а не первая незакрытая строка', () => {
    const now = goalNow({ known: 1, total: 4, next: { id: 'work', title: 'а работаешь где?' }, slots: [] });
    expect(now.text).toBe('а работаешь где?');
    expect(now.hint).toContain('work');
    expect(now.tone).toBe('ask');
  });

  it('все темы закрыты — это состояние, а не пустота', () => {
    expect(goalNow({ known: 4, total: 4, next: null, slots: [] }).tone).toBe('ok');
  });

  it('открытых тем нет, но и закрыто не всё — бот просто разговаривает', () => {
    const now = goalNow({ known: 1, total: 4, next: null, slots: [] });
    expect(now.tone).toBe('skip');
    expect(now.text).toContain('без анкеты');
  });

  it('диалога ещё не было — без выдуманного задания', () => {
    expect(goalNow(null).tone).toBe('skip');
  });
});

describe('findMessageIndex — «показать бит в переписке»', () => {
  const MSGS = [
    { content: 'Привет, как дела?', ts: 100 },
    { content: 'Работаю в  Сбере\nуже 5 лет', ts: 200 },
    { content: 'ок', ts: 300 },
  ];

  it('улика ведёт к ТОЙ САМОЙ реплике, а не к соседней по времени', () => {
    expect(findMessageIndex(MSGS, { evidence: 'Работаю в Сбере уже 5 лет', ts: 999 })).toBe(1);
  });

  it('улика сходится при разных пробелах и регистре', () => {
    expect(findMessageIndex(MSGS, { evidence: 'работаю   в сбере' })).toBe(1);
  });

  it('без улики падает на время: последнее сообщение НЕ ПОЗЖЕ доставки', () => {
    expect(findMessageIndex(MSGS, { ts: 250 })).toBe(1);
    expect(findMessageIndex(MSGS, { ts: 100 })).toBe(0);
  });

  it('улика-файл (фото) реплике не соответствует — идём по времени', () => {
    expect(findMessageIndex(MSGS, { evidence: 'data/personas/irina/photos/x.jpg', ts: 250 })).toBe(1);
  });

  it('не нашли — -1, чтобы кнопка не рисовалась (прыжок «примерно» хуже отсутствия)', () => {
    expect(findMessageIndex(MSGS, { ts: 50 })).toBe(-1);
    expect(findMessageIndex([], { ts: 200 })).toBe(-1);
    expect(findMessageIndex(MSGS, null)).toBe(-1);
    expect(findMessageIndex(MSGS, { evidence: 'такого текста нет' })).toBe(-1);
  });
});

describe('findMessageIndex — улика-ПАРА и короткие реплики', () => {
  const FEED = [
    { content: 'Зачем', role: 'user', ts: 100 },
    { content: 'да', role: 'user', ts: 200 },
    { content: 'Да просто интересно стало) а то пока летала, разговоров не хватало', role: 'assistant', ts: 300 },
    { content: 'да', role: 'user', ts: 400 },
  ];
  const PAIR = 'Клиент: «Зачем» → Ира: «Да просто интересно стало) а то пока летала, разговоров не хватало»';

  it('пара ведёт на реплику КЛИЕНТА, а не на первое короткое «да»', () => {
    expect(findMessageIndex(FEED, { evidence: PAIR, ts: 350 })).toBe(0);
  });

  it('ход Иры остаётся ЗАПАСНОЙ стороной, а не первой', () => {
    const both = [
      { content: 'Зачем', role: 'user', ts: 100 },
      { content: 'Да просто интересно стало) а то пока летала, разговоров не хватало', role: 'assistant', ts: 300 },
    ];
    expect(findMessageIndex(both, { evidence: PAIR, ts: 350 })).toBe(0);
    expect(both[findMessageIndex(both, { evidence: PAIR, ts: 350 })].role).toBe('user');
  });

  it('короткая реплика внутри улики совпадением НЕ считается', () => {
    const shortOnly = [{ content: 'да', role: 'user', ts: 100 }];
    expect(findMessageIndex(shortOnly, { evidence: PAIR, ts: 999 })).toBe(0);
    expect(findMessageIndex(shortOnly, { evidence: PAIR })).toBe(-1);
  });

  it('короткий ХВОСТОВОЙ пузырь Иры улику не перехватывает', () => {
    const tail = [
      { content: 'Да просто интересно стало) а то пока летала, разговоров не хватало', role: 'assistant', ts: 300 },
      { content: 'а то', role: 'assistant', ts: 310 },
    ];
    expect(findMessageIndex(tail, { evidence: PAIR, ts: 400 })).toBe(0);
  });

  it('эхо Иры не перехватывает клиентскую сторону улики', () => {
    const echo = [
      { content: 'Я работаю водителем фуры', role: 'user', ts: 100 },
      { content: 'ого, я работаю водителем фуры даже не представляю как это', role: 'assistant', ts: 200 },
    ];
    const ev = 'Клиент: «Я работаю водителем фуры» → Ира: «—»';
    expect(findMessageIndex(echo, { evidence: ev, ts: 250 })).toBe(0);
  });

  it('нет хода Иры в ленте — падаем на КЛИЕНТСКУЮ сторону пары, а не на что попало', () => {
    const noIra = [
      { content: 'да', role: 'user', ts: 100 },
      { content: 'Зачем', role: 'user', ts: 200 },
    ];
    expect(findMessageIndex(noIra, { evidence: PAIR, ts: 999 })).toBe(1);
  });

  it('ход Иры разбит на пузыри — сходится по куску от 12 знаков', () => {
    const bubbles = [
      { content: 'Да просто интересно стало)', role: 'assistant', ts: 300 },
      { content: 'а то пока летала, разговоров не хватало', role: 'assistant', ts: 310 },
    ];
    expect(findMessageIndex(bubbles, { evidence: PAIR, ts: 350 })).toBe(1);
  });

  it('улика обрезана многоточием — ищем ГОЛОВУ, а не строку с «…»', () => {
    const feed = [
      { content: 'Да просто интересно стало) а то показываешь себя, а сам ни слова) Ну а вообще я тут недавно, захожу редко. Подруга подтолкнула', role: 'assistant', ts: 200 },
    ];
    const cut = 'Клиент: «Зачем» → Ира: «Да просто интересно стало) а то показываешь себя, а сам ни слова) Ну а вообще я тут недавно, захожу редко. Подруга подто…»';
    expect(findMessageIndex(feed, { evidence: cut, ts: 250 })).toBe(0);
  });

  it('фраза повторяется — берём ПОСЛЕДНЕЕ вхождение не позже отметки бита', () => {
    const twice = [
      { content: 'да я и сама тоже так думала', role: 'assistant', ts: 100 },
      { content: 'угу', role: 'user', ts: 200 },
      { content: 'да я и сама тоже так думала', role: 'assistant', ts: 300 },
      { content: 'да я и сама тоже так думала', role: 'assistant', ts: 900 },
    ];
    const ev = 'Клиент: «Понятно» → Ира: «да я и сама тоже так думала»';
    expect(findMessageIndex(twice, { evidence: ev, ts: 400 })).toBe(2);
  });

  it('пин-улика места в ленте не имеет — ни машинная, ни разобранная бэком', () => {
    const feed = [
      { content: 'рисование с детства', role: 'assistant', ts: 100 },
      { content: 'а, классика - само как-то затянуло)) тоже хороший путь', role: 'assistant', ts: 200 },
    ];
    const human = { evidence: 'по пину: путь в дизайн: рисование с детства переросло в профессию', ts: 250 };
    const raw = { evidence: 'pinned_facts:_director_agenda.disclosed_bio_keys:design_path', ts: 250 };
    expect(findMessageIndex(feed, human)).toBe(1);
    expect(findMessageIndex(feed, raw)).toBe(1);
  });
});

describe('searchMessages — поиск по ленте', () => {
  const MSGS = [
    { content: 'Привет', ts: 1 },
    { content: 'Работаю в  Сбере', ts: 2 },
    { content: 'сбербанк удобный', ts: 3 },
  ];

  it('находит все совпадения без учёта регистра и лишних пробелов', () => {
    expect(searchMessages(MSGS, 'сбер')).toEqual([1, 2]);
    expect(searchMessages(MSGS, 'в  сбере')).toEqual([1]);
  });

  it('пустой запрос НЕ подсвечивает всё подряд', () => {
    expect(searchMessages(MSGS, '')).toEqual([]);
    expect(searchMessages(MSGS, '   ')).toEqual([]);
  });

  it('нет совпадений — пустой список', () => {
    expect(searchMessages(MSGS, 'втб')).toEqual([]);
  });
});

describe('phoneLabel — номер клиента для блока инфы', () => {
  it('типизированный слот приоритетнее кода намерения', () => {
    expect(phoneLabel({ phone: 'commit_intent', handoff_phone_collected: '+79001234567' })).toBe(
      '+79001234567',
    );
  });

  it('номер прямо в phone показывается как есть', () => {
    expect(phoneLabel({ phone: '+79001234567' })).toBe('+79001234567');
  });

  it('код намерения показывается словами, а не кодом', () => {
    expect(phoneLabel({ phone: 'commit_intent' })).toBe('готов дать');
  });

  it('нечего показать — null, прочерк рисует вызывающий', () => {
    expect(phoneLabel({})).toBeNull();
    expect(phoneLabel(null)).toBeNull();
  });

  it('реальный номер из БД, когда в пинах телефона нет (D-123)', () => {
    expect(phoneLabel({}, '+79240232350')).toBe('+79240232350');
  });

  it('номер из БД приоритетнее кода намерения', () => {
    expect(phoneLabel({ phone: 'commit_intent' }, '+79240232350')).toBe('+79240232350');
  });

  it('номер в пине приоритетнее номера из БД', () => {
    expect(phoneLabel({ phone: '+79001234567' }, '+79240232350')).toBe('+79001234567');
  });

  it('типизированный слот приоритетнее номера из БД', () => {
    expect(
      phoneLabel({ handoff_phone_collected: '+79001234567' }, '+79240232350'),
    ).toBe('+79001234567');
  });
});

describe('stillPending — свой ход, пока он не доехал в ленту', () => {
  const out = (t) => ({ role: 'assistant', author: 'operator:web', content: t });

  it('доставленный ход снимается, недоставленный остаётся', () => {
    const left = stillPending([{ text: 'привет' }, { text: 'как дела' }], [out('привет')]);
    expect(left.map((p) => p.text)).toEqual(['как дела']);
  });

  it('два одинаковых текста: доехал один — второй остаётся висеть', () => {
    const left = stillPending([{ text: 'фыва' }, { text: 'фыва' }], [out('фыва')]);
    expect(left).toHaveLength(1);
  });

  it('совпадение по реплике КЛИЕНТА не снимает свой пузырь', () => {
    const left = stillPending([{ text: 'фыва' }], [{ role: 'user', content: 'фыва' }]);
    expect(left).toHaveLength(1);
  });

  it('пустые входы не падают', () => {
    expect(stillPending([], undefined)).toEqual([]);
    expect(stillPending(null, [])).toEqual([]);
  });
});

describe('isMediaEvidence — улика-путь против улики-цитаты (R-C)', () => {
  it('пути к файлам опознаются, относительные и абсолютные', () => {
    expect(isMediaEvidence('data/personas/irina/photos/phuket_pool_selfie.jpg')).toBe(true);
    expect(isMediaEvidence('/home/xuan/DEV/Chutter_v2/data/personas/irina/videos/v.mp4')).toBe(true);
    expect(isMediaEvidence('data/personas/irina/voice/a.oga')).toBe(true);
  });

  it('цитаты и пины уликой-путём НЕ считаются', () => {
    expect(isMediaEvidence('Клиент: «Зачем» → Ира: «Да просто интересно)»')).toBe(false);
    expect(isMediaEvidence('по пину: путь в дизайн: рисование с детства')).toBe(false);
    expect(isMediaEvidence('Работаю в Сбере уже 5 лет')).toBe(false);
    expect(isMediaEvidence('прислал файл kartinka.png')).toBe(false);
    expect(isMediaEvidence('')).toBe(false);
    expect(isMediaEvidence(null)).toBe(false);
    expect(isMediaEvidence(undefined)).toBe(false);
  });
});

describe('beatComment — улика доставки, разобранная для рендера', () => {
  it('пара R-B делится на стороны; вложенные кавычки не ломают разбор', () => {
    expect(
      beatComment({
        evidence: 'Клиент: «Чему ещё научишь?» → Ира: «Поймал) как вернусь - сыграем»',
      }),
    ).toEqual({
      kind: 'pair',
      client: 'Чему ещё научишь?',
      ira: 'Поймал) как вернусь - сыграем',
    });
    expect(
      beatComment({ evidence: 'Клиент: «С пляжа в самый раз в собственном соку» → Ира: «Ой, ну я жду)»' }),
    ).toEqual({ kind: 'pair', client: 'С пляжа в самый раз в собственном соку', ira: 'Ой, ну я жду)' });
  });

  it('пустая сторона пары (бэкфилл печатает «—») приходит null, а не прочерк-текст', () => {
    expect(beatComment({ evidence: 'Клиент: «—» → Ира: «Привет)»' })).toEqual({
      kind: 'pair',
      client: null,
      ira: 'Привет)',
    });
  });

  it('пин: служебный шум леджера снят, известный ключ — с фразой', () => {
    expect(
      beatComment({ evidence: 'pinned_facts:_director_agenda.disclosed_bio_keys:design_path' }),
    ).toEqual({ kind: 'pin', phrase: 'в анкете раскрыто био', key: 'disclosed_bio_keys', value: 'design_path' });
  });

  it('пин с неизвестным ключом отдаётся КАК ЕСТЬ, без выдуманной фразы', () => {
    expect(beatComment({ evidence: 'pinned_facts:_writer.some_new_key:code' })).toEqual({
      kind: 'pin',
      phrase: null,
      key: 'some_new_key',
      value: 'code',
    });
    expect(beatComment({ evidence: 'pinned_facts:_writer.bare_key' })).toEqual({
      kind: 'pin',
      phrase: null,
      key: 'bare_key',
      value: null,
    });
  });

  it('пин, разобранный бэком, — это пин, а не цитата (иначе «по пину: «по пину: …»»)', () => {
    expect(
      beatComment({ evidence: 'по пину: путь в дизайн: рисование с детства переросло в профессию' }),
    ).toEqual({
      kind: 'pin',
      phrase: 'путь в дизайн: рисование с детства переросло в профессию',
      key: null,
      value: null,
    });
  });

  it('заключение судьи (фаза 2) — главный текст, улика — при ней', () => {
    expect(
      beatComment({
        reason: 'Ира пообещала сыграть, как вернётся, — приглашение прозвучало',
        evidence: 'Поймал) как вернусь - сыграем',
      }),
    ).toEqual({
      kind: 'reason',
      text: 'Ира пообещала сыграть, как вернётся, — приглашение прозвучало',
      evidence: 'Поймал) как вернусь - сыграем',
    });
    expect(beatComment({ reason: 'обмен знакомством состоялся', evidence: '' })).toEqual({
      kind: 'reason',
      text: 'обмен знакомством состоялся',
      evidence: null,
    });
  });

  it('без заключения — прежние виды: пара, пин, цитата, путь, пусто', () => {
    expect(beatComment({ evidence: 'Клиент: «Артур» → Ира: «Приятно)»' }).kind).toBe('pair');
    expect(
      beatComment({ evidence: 'pinned_facts:_director_agenda.disclosed_bio_keys:design_path' })
        .kind,
    ).toBe('pin');
    expect(beatComment({ evidence: 'Я боялась неадекватных' }).kind).toBe('quote');
    expect(beatComment({ evidence: 'data/personas/irina/photos/x.jpg' }).kind).toBe('media');
    expect(beatComment({ reason: '' })).toBeNull();
    expect(beatComment({ reason: '   ', evidence: null })).toBeNull();
  });

  it('цитата судьи проходит как есть, путь к файлу — видом media, пустое — null', () => {
    expect(beatComment({ evidence: 'Я боялась неадекватных' })).toEqual({
      kind: 'quote',
      text: 'Я боялась неадекватных',
    });
    expect(beatComment({ evidence: 'data/personas/irina/photos/phuket_pool_selfie.jpg' })).toEqual({
      kind: 'media',
    });
    expect(beatComment({ evidence: '' })).toBeNull();
    expect(beatComment({ evidence: null })).toBeNull();
    expect(beatComment(undefined)).toBeNull();
  });
});
