import { generateDraft } from './generate';
import { judgeResponseText } from '../judge/transport';

function deps() {
  const calls: any[] = [];
  return {
    calls,
    deps: {
      client: {
        messages: {
          create: async (params: any) => {
            calls.push(params);
            return {
              content: [{ type: 'text', text: '{"ok":true}' }],
              stop_reason: 'end_turn',
              usage: { input_tokens: 1, output_tokens: 1 },
            };
          },
        },
      } as any,
      usageDb: { record: async () => undefined } as any,
      logger: { info() {}, warn() {}, error() {} },
    },
  };
}

describe('уровень рассуждения в запросе', () => {
  it('генератор: по умолчанию без мыслей, с рассуждением — уровень и запас токенов', async () => {
    const off = deps();
    await generateDraft(
      {
        model: 'claude-sonnet-5',
        system: { stable: 'P' },
        history: [],
        userText: 'привет',
      },
      off.deps,
    );
    expect(off.calls[0].thinking).toEqual({ type: 'disabled' });
    expect(off.calls[0].max_tokens).toBe(2048);

    const high = deps();
    await generateDraft(
      {
        model: 'z-ai/glm-5.3',
        system: { stable: 'P' },
        history: [],
        userText: 'привет',
        effort: 'high',
      },
      high.deps,
    );
    expect(high.calls[0].output_config).toEqual({ effort: 'high' });
    expect(high.calls[0].max_tokens).toBe(16_000);
  });

  it('судья: «без рассуждений» и запас токенов по глубине', async () => {
    const off = deps();
    await judgeResponseText(
      { ...off.deps, effort: 'off' },
      { stable: 'J' },
      {},
      5000,
      'judge_review',
    );
    expect(off.calls[0].thinking).toEqual({ type: 'disabled' });
    expect(off.calls[0].max_tokens).toBe(5000);

    const high = deps();
    await judgeResponseText(
      { ...high.deps, effort: 'high' },
      { stable: 'J' },
      {},
      5000,
      'judge_review',
    );
    expect(high.calls[0].output_config).toEqual({ effort: 'high' });
    expect(high.calls[0].max_tokens).toBe(15_000);
  });
});
