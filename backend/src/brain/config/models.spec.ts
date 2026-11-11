import {
  EFFORT_OPTIONS,
  GENERATOR_MODEL,
  JUDGE_MODEL,
  MODEL_OPTIONS,
  OPUS_5_5,
  SONNET_5_5,
  generatorEffortFor,
  generatorModelFor,
  isEffort,
  isGeneratorModel,
  isJudgeModel,
  judgeEffortFor,
  judgeModelFor,
  withChatModels,
} from './models';

describe('модель на личность', () => {
  it('без личности и окружения берутся умолчания из кода', () => {
    expect(generatorModelFor(null)).toBe(GENERATOR_MODEL);
    expect(judgeModelFor(null)).toBe(JUDGE_MODEL);
    expect(generatorModelFor({})).toBe(GENERATOR_MODEL);
  });

  it('окружение перекрывает умолчание из кода', () => {
    expect(generatorModelFor(null, OPUS_5_5)).toBe(OPUS_5_5);
    expect(judgeModelFor(null, GENERATOR_MODEL)).toBe(GENERATOR_MODEL);
  });

  it('личность перекрывает окружение', () => {
    const persona = { generatorModel: OPUS_5_5, judgeModel: GENERATOR_MODEL };
    expect(generatorModelFor(persona, GENERATOR_MODEL)).toBe(OPUS_5_5);
    expect(judgeModelFor(persona, OPUS_5_5)).toBe(GENERATOR_MODEL);
  });

  it('пустое значение у личности значит «как в окружении»', () => {
    expect(generatorModelFor({ generatorModel: null }, OPUS_5_5)).toBe(
      OPUS_5_5,
    );
    expect(judgeModelFor({ judgeModel: '' }, OPUS_5_5)).toBe(OPUS_5_5);
  });

  it('неизвестная модель у личности — ошибка, а не тихий откат', () => {
    expect(() => generatorModelFor({ generatorModel: 'gpt-9' })).toThrow();
    expect(() => judgeModelFor({ judgeModel: 'gpt-9' })).toThrow();
  });

  it('проверки для API знают список допустимых моделей', () => {
    expect(isGeneratorModel(OPUS_5_5)).toBe(true);
    expect(isGeneratorModel('gpt-9')).toBe(false);
    expect(isJudgeModel(GENERATOR_MODEL)).toBe(true);
    expect(isJudgeModel(null)).toBe(false);
  });

  it('Sonnet 5.5 доступен и генератору, и судье, и панели', () => {
    expect(isGeneratorModel(SONNET_5_5)).toBe(true);
    expect(isJudgeModel(SONNET_5_5)).toBe(true);
    expect(generatorModelFor({ generatorModel: SONNET_5_5 })).toBe(SONNET_5_5);
    expect(judgeModelFor({ judgeModel: SONNET_5_5 })).toBe(SONNET_5_5);
    expect(MODEL_OPTIONS.map(([id]) => id)).toContain(SONNET_5_5);
  });
});

describe('рассуждение на личность', () => {
  it('генератор по умолчанию без рассуждений, судьи — из окружения', () => {
    expect(generatorEffortFor(null)).toBe('off');
    expect(generatorEffortFor({ generatorEffort: null })).toBe('off');
    expect(judgeEffortFor(null, 'low')).toBe('low');
  });

  it('выбор личности перекрывает умолчание; мусор не принимается', () => {
    expect(generatorEffortFor({ generatorEffort: 'high' })).toBe('high');
    expect(judgeEffortFor({ judgeEffort: 'off' }, 'low')).toBe('off');
    expect(judgeEffortFor({ judgeEffort: 'max' }, 'medium')).toBe('medium');
    expect(isEffort('medium')).toBe(true);
    expect(isEffort('max')).toBe(false);
    expect(EFFORT_OPTIONS.map(([id]) => id)).toEqual([
      'off',
      'low',
      'medium',
      'high',
    ]);
  });
});

describe('модели диалога', () => {
  it('диалог перекрывает личность поле за полем; пустое — как у личности', () => {
    const persona = {
      generatorModel: SONNET_5_5,
      judgeModel: null,
      generatorEffort: 'low',
      judgeEffort: null,
    };
    expect(withChatModels(persona, null)).toBe(persona);
    expect(withChatModels(persona, { generatorModel: null })).toBe(persona);
    expect(
      withChatModels(persona, {
        generatorModel: 'z-ai/glm-5.3',
        judgeModel: null,
        judgeEffort: 'high',
      }),
    ).toEqual({
      generatorModel: 'z-ai/glm-5.3',
      judgeModel: null,
      generatorEffort: 'low',
      judgeEffort: 'high',
    });
  });
});
