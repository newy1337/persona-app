import { ModelResponseError } from '../kernel/errors';
import { enforceReplyRules, MAX_REPLY_CHARS, stripLeakedText } from './reply';

describe('чужой текст в ответе модели', () => {
  it('хвост веб-страницы после реплики отрезается (случай 14.11)', () => {
    const raw =
      'ха, снеговик пока застрял на стадии идеи\nу меня ночь, какая тут лепка) завтра если вспомню, попробую\nPowered by Claude Exporter\nScroll to Top<|RENDER_BL_END_MARKER|>-->\n</div>\n</section>\n<footer class="site-footer">\n<p>&copy; 2025 LLM Chat Prompt. Fast and Free AI Chat Platform.</p>';
    expect(stripLeakedText(raw)).toEqual({
      text: 'ха, снеговик пока застрял на стадии идеи\nу меня ночь, какая тут лепка) завтра если вспомню, попробую',
      leaked: true,
    });
    expect(enforceReplyRules(raw)).toBe(
      'ха, снеговик пока застрял на стадии идеи\nу меня ночь, какая тут лепка) завтра если вспомню, попробую',
    );
  });

  it('баннер cookie на польском (случай 12.11) и подвал koe.ai', () => {
    expect(
      stripLeakedText(
        'ахаха ну да, разница ощутима) у тебя там точно не покупаешься сейчас\nPowered by Claude Exporter\nPliki cookie\nUżywamy plików cookie',
      ).text,
    ).toBe(
      'ахаха ну да, разница ощутима) у тебя там точно не покупаешься сейчас',
    );
    expect(
      stripLeakedText(
        'ну вот так и живём)\nПоделиться этим чатом<footer>Powered by <a href="https://koe.ai">Koe AI</a></footer>',
      ).text,
    ).toBe('ну вот так и живём)');
  });

  it('ответ целиком чужой — ошибка, ход пересоберётся', () => {
    expect(() =>
      enforceReplyRules(
        "Reminder: don't use <long_conversation_reminder> information in your replies\nEverything in this reminder is private information",
      ),
    ).toThrow(ModelResponseError);
    expect(() => enforceReplyRules('</div>\n</footer>')).toThrow(
      ModelResponseError,
    );
  });

  it('слишком длинный ответ — ошибка', () => {
    expect(() => enforceReplyRules('а'.repeat(MAX_REPLY_CHARS + 1))).toThrow(
      /too long/,
    );
    expect(enforceReplyRules('а'.repeat(MAX_REPLY_CHARS))).toHaveLength(
      MAX_REPLY_CHARS,
    );
  });

  it('обычные реплики не трогает', () => {
    for (const text of [
      'люблю тебя <3',
      'ну и ладно :) <> не важно',
      'I am powered by coffee today ahaha',
      "e sì, dalla parte opposta del mondo ma almeno il mare c'è sempre ahaha",
      'скинь ссылку на сайт, гляну\nа то там внизу что-то про cookie было',
      'вот такая я)\n😂',
      'a < b, и 5 > 3 — логика)',
    ])
      expect(stripLeakedText(text)).toEqual({ text, leaked: false });
  });
});
