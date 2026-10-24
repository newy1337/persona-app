import { DEFAULT_PROMPTS, PROMPT_KEYS, mergePrompts } from './prompts';
import { fillVariables } from './variables';

describe('в промтах по умолчанию стоит имя личности, а не чужое', () => {
  const defaults = mergePrompts(null);

  it('ни один промт не называет конкретную личность по имени', () => {
    for (const key of PROMPT_KEYS) {
      expect(defaults[key]).not.toMatch(/Наст[яеиюё]/);
    }
  });

  it('судья и проверка знают, чью переписку разбирают', () => {
    expect(defaults.judge_plan).toContain('{name}');
    expect(defaults.judge_review).toContain('{name}');
  });

  it('первое сообщение лиду представляет личность и её сайт', () => {
    expect(defaults.opener).toContain('{name}');
    expect(defaults.opener).toContain('{site}');
  });

  /** Личность подставляется той же машинкой, что и остальные переменные. */
  it('подстановка даёт имя мужской личности без следов прежней', () => {
    const filled = fillVariables(
      { ...DEFAULT_PROMPTS },
      { name: 'Денис' },
    ) as Record<string, string>;
    expect(filled.judge_plan).toContain('не пишешь ответ за Денис');
    expect(filled.judge_review).toContain('Отвечает Денис');
    for (const key of PROMPT_KEYS) expect(filled[key]).not.toContain('{name}');
  });

  it('подстановка не склоняет: имя попадает в текст как есть', () => {
    const filled = fillVariables(
      { ...DEFAULT_PROMPTS },
      { name: 'Денис' },
    ) as Record<string, string>;
    // Падеж не согласуется, и это осознанно: смысл однозначен, а склонять
    // имена подстановкой переменных мы не беремся.
    expect(filled.judge_plan).toContain('ответ за Денис.');
    expect(filled.judge_review).toContain('Отвечает Денис:');
  });

  it('сайт остаётся переменной диалога и подставляется позже', () => {
    const filled = fillVariables(
      { ...DEFAULT_PROMPTS },
      { name: 'Надя' },
    ) as Record<string, string>;
    expect(filled.opener).toBe('Привет, это Надя с {site}');
  });
});
