import { UnprocessableEntityException } from '@nestjs/common';
import { ConversationsService } from './conversations.service';

function setup() {
  const update = jest.fn(async (args: any) => ({
    generatorModel: null,
    judgeModel: null,
    generatorEffort: null,
    judgeEffort: null,
    ...args.data,
  }));
  const forgetRows = jest.fn();
  const ensureContact = jest.fn(async () => undefined);
  const deps: any[] = Array(16).fill(undefined);
  deps[0] = { contact: { update } };
  deps[1] = { ensureContact };
  deps[8] = { forgetRows };
  const service = new (ConversationsService as any)(...deps);
  return { service, update, forgetRows, ensureContact };
}

describe('модели диалога: сохранение', () => {
  it('пишет выбранное, сбрасывает кеш личности и отдаёт выбор', async () => {
    const { service, update, forgetRows, ensureContact } = setup();
    const view = await service.setModels(7, {
      generatorModel: 'z-ai/glm-5.3',
      judgeEffort: 'high',
      judgeModel: null,
    });
    expect(ensureContact).toHaveBeenCalledWith(7);
    expect(update.mock.calls[0][0].data).toEqual({
      generatorModel: 'z-ai/glm-5.3',
      judgeEffort: 'high',
      judgeModel: null,
    });
    expect(forgetRows).toHaveBeenCalled();
    expect(view).toEqual({
      generator_model: 'z-ai/glm-5.3',
      judge_model: null,
      generator_effort: null,
      judge_effort: 'high',
    });
  });

  it('неизвестная модель или уровень — отказ без записи', async () => {
    const { service, update } = setup();
    await expect(
      service.setModels(7, { generatorModel: 'gpt-9' }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(
      service.setModels(7, { judgeEffort: 'max' }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(update).not.toHaveBeenCalled();
  });
});
