// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import React, { act } from 'react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot } from 'react-dom/client';

const { default: Balance } = await import('./Balance');

function render(data) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  act(() => createRoot(host).render(React.createElement(Balance, { data })));
  return host;
}

const full = {
  total: 1500, spent: 1250.85, left: 249.15,
  today: 161.48, week: 350.69, month: 1250.85,
  days_left: 1.5, checked_at: 1790700000, error: null,
};

describe('баланс OpenRouter', () => {
  it('показывает остаток и расход', () => {
    const host = render(full);
    expect(host.textContent).toContain('$249.15');
    expect(host.textContent).toContain('$161.48');
  });

  it('в блоке только остаток и расход — ничего лишнего', () => {
    const host = render(full);
    expect(host.textContent.replace(/\s+/g, ' ').trim()).toBe(
      'OpenRouter$249.15$161.48 сегодня$350.69 за неделю$1250.85 за месяц',
    );
  });

  it('тревожная рамка загорается только на малом остатке', () => {
    const alarm = render({ ...full, days_left: 0.8 }).querySelector('[data-testid="balance-card"]').className;
    const calm = render({ ...full, days_left: 12 }).querySelector('[data-testid="balance-card"]').className;
    expect(alarm).not.toBe(calm);
    expect(alarm).toMatch(/Alarm/);
    expect(calm).toMatch(/Calm/);
  });

  it('ошибку показывает словами, а не пустым блоком', () => {
    const host = render({ ...full, error: 'ключ OpenRouter не задан' });
    expect(host.textContent).toContain('ключ OpenRouter не задан');
    expect(host.querySelector('[data-testid="balance-card"]')).toBeNull();
  });

  it('без данных блок не занимает место', () => {
    expect(render(null).textContent).toBe('');
  });

  it('неизвестные числа не превращаются в ноль', () => {
    const host = render({ ...full, left: null, days_left: null });
    expect(host.textContent).toContain('—');
  });
});
