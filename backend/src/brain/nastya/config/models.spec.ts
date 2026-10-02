import {
  GENERATOR_MODEL,
  JUDGE_MODEL,
  MODEL_OPTIONS,
  OPUS_5_5,
  SONNET_5_5,
  generatorModelFor,
  isGeneratorModel,
  isJudgeModel,
  judgeModelFor,
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
