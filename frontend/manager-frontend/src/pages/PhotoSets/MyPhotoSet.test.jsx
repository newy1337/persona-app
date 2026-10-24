// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { api } from '../../api/client';
import { PanelUX } from '../../ui/PanelUX';
import { MyPhotoSets } from './PhotoSets';
import { PhotoCell, personaNote } from './StaffAssignments';

vi.mock('../../components/Header/Header', () => ({ default: () => null }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host, root;
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });
const render = async (el) => act(async () => root.render(el));
const pick = async (select, value) => act(async () => { select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); });

const personas = [{ slug: 'denis', name: 'Денис', accounts: 2 }, { slug: 'nastya', name: 'Настя', accounts: 1 }];
const mine = (sets) => ({ sets, personas });

test('без назначенных образов блока нет', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({ sets: [], personas });
  await render(<MyPhotoSets />);
  expect(host.querySelector('[data-testid="my-photo-sets"]')).toBeNull();
});

test('сотрудник привязывает каждый свой образ к личности', async () => {
  vi.spyOn(api, 'get').mockResolvedValue(mine([
    { set_id: 7, set_name: 'Тест', persona_slug: null, persona_name: null },
    { set_id: 8, set_name: 'Зима', persona_slug: 'nastya', persona_name: 'Настя' },
  ]));
  const put = vi.spyOn(api, 'put').mockResolvedValue(mine([
    { set_id: 7, set_name: 'Тест', persona_slug: 'denis', persona_name: 'Денис' },
    { set_id: 8, set_name: 'Зима', persona_slug: 'nastya', persona_name: 'Настя' },
  ]));
  const onChanged = vi.fn();
  await render(<MyPhotoSets onChanged={onChanged} />);
  const selects = host.querySelectorAll('[data-testid="my-photo-sets"] select');
  expect(selects).toHaveLength(2);
  expect(selects[1].value).toBe('nastya');
  expect([...selects[0].options].map((o) => o.textContent)).toEqual(['— в запасе, фото не уходят —', 'Денис · аккаунтов: 2', 'Настя · аккаунтов: 1']);
  await pick(selects[0], 'denis');
  expect(put).toHaveBeenCalledWith('/api/photo-sets/mine', { set_id: 7, persona_slug: 'denis' });
  expect(onChanged).toHaveBeenCalled();
});

test('новый образ на занятую личность — с предупреждением про старых и новых собеседников', async () => {
  vi.spyOn(api, 'get').mockResolvedValue(mine([
    { set_id: 7, set_name: 'Тест', persona_slug: null, persona_name: null },
    { set_id: 8, set_name: 'Зима', persona_slug: 'nastya', persona_name: 'Настя' },
  ]));
  const put = vi.spyOn(api, 'put').mockResolvedValue(mine([]));
  const confirm = vi.spyOn(PanelUX, 'confirm').mockResolvedValue(false);
  await render(<MyPhotoSets />);
  await pick(host.querySelectorAll('[data-testid="my-photo-sets"] select')[0], 'nastya');
  expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('Начатые диалоги останутся на «Зима»') }));
  expect(put).not.toHaveBeenCalled();
});

test('у хеда: образы учётки с личностями и выбор набора в попапе', async () => {
  expect(personaNote({ set_name: 'Тест', persona_name: 'Денис' })).toBe('Тест → Денис');
  expect(personaNote({ set_name: 'Зима', persona_name: null })).toBe('Зима → в запасе');
  const save = vi.fn(async () => {});
  const state = { busy: null, picking: null, save, setPicking: (v) => { state.picking = v; } };
  const data = { '001': { can_assign: true, sets: [{ id: 7, name: 'Тест' }, { id: 8, name: 'Зима' }, { id: 9, name: 'Город' }], rows: [{ user_id: 2, username: 'Manager2', personas, sets: [{ set_id: 7, set_name: 'Тест', persona_slug: 'denis', persona_name: 'Денис' }] }] } };
  await render(<PhotoCell user={{ user_id: 2, region_code: '001' }} photo={{ ...state, byRegion: data }} />);
  const cell = host.querySelector('[data-testid="photo-cell-2"]');
  expect(cell.textContent).toContain('Тест → Денис');
  expect(cell.querySelector('button').textContent).toBe('Образы: 1');
  await render(<PhotoCell user={{ user_id: 2, region_code: '001' }} photo={{ ...state, picking: 2, byRegion: data }} />);
  const dialog = host.querySelector('[role=dialog]');
  const boxes = dialog.querySelectorAll('input[type=checkbox]');
  expect([...boxes].map((b) => b.checked)).toEqual([true, false, false]);
  await act(async () => boxes[1].click());
  await act(async () => boxes[2].click());
  await act(async () => [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Сохранить').click());
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ user_id: 2 }), '001', [7, 8, 9]);
});
