import { mergePrompts } from '../config/prompts';
import { buildCharacterPrompt } from './prompt';
import { EXCLUSIVE_RULE } from './exclusivity';

it('правило «общаешься только с ним» — в постоянной части промпта при любой личности', () => {
  const prompt = buildCharacterPrompt({
    config: { persona: {}, day: {}, goals: {}, storylines: {} },
    runtime: { date: '2026-11-16', day: {}, storylines: [] } as any,
    judgment: {},
    name: 'Настя',
    prompts: mergePrompts({}),
  });
  expect(prompt.stable).toContain(EXCLUSIVE_RULE);
  expect(EXCLUSIVE_RULE).toContain('ты ещё с кем-то общаешься?');
});
