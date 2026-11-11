// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, test } from 'vitest';
import GoalsStats from './GoalsStats';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host, root;
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

test('по личности: доля диалогов на каждую цель, название вместо id', async () => {
  const data = {
    personas: [{
      persona_id: 'nastya', name: 'Настя', chats: 40, percent: 41.7,
      goals: [
        { id: 'name', title: 'Имя', topic: null, known: 30, percent: 75 },
        { id: 'pets', title: 'pets', topic: 'есть ли животные', known: 5, percent: 12.5 },
      ],
    }],
  };
  await act(async () => root.render(<GoalsStats data={data} />));
  const card = host.querySelector('[data-testid="goals-nastya"]');
  expect(card.textContent).toContain('40 диалогов · узнано в среднем 41.7%');
  const rows = [...card.querySelectorAll('tbody tr')].map((tr) => [...tr.cells].slice(0, 3).map((td) => td.textContent));
  expect(rows).toEqual([['Имя · name', '30', '75%'], ['pets', '5', '12.5%']]);
});

test('пустой период', async () => {
  await act(async () => root.render(<GoalsStats data={{ personas: [] }} />));
  expect(host.textContent).toContain('не начал ни одного диалога');
});
