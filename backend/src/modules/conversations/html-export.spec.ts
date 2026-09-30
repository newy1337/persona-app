import { authorLabel, renderChatHtml } from './html-export';
import { splitLabel } from './chat-export.service';

describe('выгрузка переписки в HTML', () => {
  it('метка вложения отделяется от расшифровки и подписи', () => {
    expect(splitLabel('[Голосовое сообщение]\nя на рыбалке')).toEqual({
      label: 'Голосовое сообщение',
      rest: 'я на рыбалке',
    });
    expect(splitLabel('[Стикер: 😂]')).toEqual({
      label: 'Стикер: 😂',
      rest: '',
    });
    expect(splitLabel('просто текст [в скобках]')).toEqual({
      label: null,
      rest: 'просто текст [в скобках]',
    });
  });

  it('кто написал — словами', () => {
    expect(authorLabel('user', 'client')).toBe('');
    expect(authorLabel('assistant', 'llm')).toBe('Бот');
    expect(authorLabel('assistant', 'operator:7')).toBe('Менеджер');
    expect(authorLabel('assistant', 'morning')).toBe('Бот · доброе утро');
  });

  it('разделители по дням (МСК), текст экранирован, ссылки кликабельны', () => {
    const html = renderChatHtml({
      chatId: 1,
      clientName: 'Аня',
      clientUsername: 'anya',
      clientPhone: null,
      clientCity: null,
      clientAge: 30,
      clientAvatar: null,
      accountName: 'Настя',
      accountUsername: 'nastya',
      accountAvatar: null,
      personaName: 'Настя',
      stage: 'разговорились',
      exportedAt: 1789000000,
      exportedBy: 'admin',
      skippedMedia: 0,
      messages: [
        {
          id: 1,
          ts: Date.UTC(2026, 8, 16, 20, 30) / 1000,
          role: 'user',
          author: 'client',
          text: 'смотри https://example.com <b>x</b>',
        },
        {
          id: 2,
          ts: Date.UTC(2026, 8, 16, 21, 30) / 1000,
          role: 'assistant',
          author: 'llm',
          text: 'ага',
          read: true,
        },
      ],
    });
    expect(html.match(/class="day"/g)).toHaveLength(2);
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(html).toContain(
      '<a href="https://example.com" target="_blank" rel="noreferrer">https://example.com</a>',
    );
    expect(html).toContain('Этап: разговорились');
  });
});
