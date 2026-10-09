// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SupportDialog, { pickScreenshots } from './SupportDialog';
import * as api from '../../api/support';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.URL.createObjectURL ??= () => 'blob:x';
globalThis.URL.revokeObjectURL ??= () => {};

const file = (name, type, size = 10) => new File([new Uint8Array(size)], name, { type });

describe('отбор скриншотов', () => {
  it('режет чужие типы, большие файлы и лишние', () => {
    const r = pickScreenshots([], [file('a.png', 'image/png'), file('b.pdf', 'application/pdf'), file('c.jpg', 'image/jpeg', 6 * 1024 * 1024)]);
    expect(r.files.map((f) => f.name)).toEqual(['a.png']);
    expect(r.rejected).toHaveLength(2);
    const six = Array.from({ length: 6 }, (_, i) => file(`${i}.png`, 'image/png'));
    expect(pickScreenshots([], six).files).toHaveLength(5);
  });
});

describe('форма поддержки', () => {
  let host, root;
  beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
  afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });

  it('кнопка «Отправить» неактивна без текста, после отправки уходит страница и файлы', async () => {
    const send = vi.spyOn(api, 'sendSupportReport').mockResolvedValue({ ok: true });
    const onClose = vi.fn();
    await act(async () => root.render(<SupportDialog onClose={onClose} />));
    const submit = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Отправить');
    expect(submit.disabled).toBe(true);
    const ta = host.querySelector('textarea');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, '  Сломалось  ');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(submit.disabled).toBe(false);
    await act(async () => host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(send).toHaveBeenCalledWith({ text: 'Сломалось', page: window.location.pathname, files: [] });
    expect(host.textContent).toContain('Отправлено');
  });
});
