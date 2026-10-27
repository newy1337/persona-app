// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { PersonaSelect } from './Leads';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host, root;
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

const personas = [
  { slug: 'nastya', name: 'Настя', accounts: 3, accounts_ready: 2, by_channel: { telegram: { accounts: 2, ready: 1 }, vk: { accounts: 1, ready: 1 } } },
  { slug: 'artem', name: 'Артем', accounts: 1, accounts_ready: 1, by_channel: { telegram: { accounts: 1, ready: 1 }, vk: { accounts: 0, ready: 0 } } },
];
const options = () => [...host.querySelectorAll('option')].map((o) => [o.value, o.textContent, o.disabled]);

test('у VK-лида счётчик по аккаунтам VK, личность без них выбрать нельзя; у Telegram — только Telegram', async () => {
  await act(async () => root.render(<PersonaSelect personas={personas} value="" onChange={() => {}} channel="vk" />));
  expect(options()).toEqual([
    ['', 'любая личность', false],
    ['nastya', 'Настя · 1 акк. VK в сети', false],
    ['artem', 'Артем · нет аккаунтов VK', true],
  ]);
  await act(async () => root.render(<PersonaSelect personas={personas} value="artem" onChange={() => {}} channel="vk" />));
  expect(options()[2][2]).toBe(false);
  await act(async () => root.render(<PersonaSelect personas={personas} value="" onChange={() => {}} />));
  expect(options().slice(1)).toEqual([
    ['nastya', 'Настя · 1 акк. в сети', false],
    ['artem', 'Артем · 1 акк. в сети', false],
  ]);
});
