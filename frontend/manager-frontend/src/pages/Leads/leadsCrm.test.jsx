// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('../../api/leads', () => ({ updateLead: vi.fn(async (id, patch) => ({ id, ...patch })) }));
vi.mock('../../api/conversations', () => ({ setDealStage: vi.fn(async () => ({})) }));

import { updateLead } from '../../api/leads';
import { setDealStage } from '../../api/conversations';
import { LeadsBoard } from './LeadsBoard';
import { LeadCard } from './LeadCard';
import { fromLocalInput, leadTypeLabel, matchesType, nextStepState, nextStepWhen, toLocalInput } from './leadInfo';

const NOW = Date.parse('2026-10-27T12:00:00+03:00') / 1000;
const lead = (extra = {}) => ({ id: 1, first_name: 'Ира', status: 'contacted', attempts: 1, inserted_at: NOW - 86400, ...extra });

describe('тип лида и срок следующего шага', () => {
  it('холодка / хот, перезабив — отдельной меткой фильтра', () => {
    expect(leadTypeLabel(lead({ cold: true }))).toBe('Холодка');
    expect(leadTypeLabel(lead())).toBe('Хот');
    expect(matchesType(lead({ reassigned: true }), ['reassigned'])).toBe(true);
    expect(matchesType(lead({ cold: true }), ['hot'])).toBe(false);
    expect(matchesType(lead(), [])).toBe(true);
  });

  it('просрочен / сегодня / позже / без даты / нет шага', () => {
    expect(nextStepState(lead(), NOW)).toBe('none');
    expect(nextStepState(lead({ next_step: 'позвонить' }), NOW)).toBe('open');
    expect(nextStepState(lead({ next_step_at: NOW - 60 }), NOW)).toBe('overdue');
    expect(nextStepState(lead({ next_step_at: NOW + 3600 }), NOW)).toBe('today');
    expect(nextStepState(lead({ next_step_at: NOW + 3 * 86400 }), NOW)).toBe('later');
    expect(nextStepWhen(lead({ next_step_at: NOW + 3600 }), NOW)).toBe('сегодня 13:00');
    expect(nextStepWhen(lead({ next_step_at: NOW - 86400 }), NOW)).toBe('просрочен · 26.10, 12:00');
  });

  it('поле даты — московское время туда и обратно', () => {
    expect(toLocalInput(NOW)).toBe('2026-10-27T12:00');
    expect(fromLocalInput('2026-10-27T12:00')).toBe(NOW);
    expect(fromLocalInput('')).toBeNull();
  });
});

let host, root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.clearAllMocks();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('воронка лидов', () => {
  const rows = [
    lead({ id: 1, telegram_user_id: 501, deal_stage: 'vbros' }),
    lead({ id: 2, telegram_user_id: 502 }),
    lead({ id: 3, first_name: 'Без чата' }),
    lead({ id: 4, telegram_user_id: 504, deal_stage: 'deposit', next_step: 'выплата', next_step_at: 1 }),
  ];
  const column = (stage) => host.querySelector(`[data-stage="${stage}"]`);
  const ids = (stage) => [...column(stage).querySelectorAll('[data-lead-id]')].map((el) => Number(el.dataset.leadId));

  it('лиды лежат по этапам, без этапа и без диалога — в «Без этапа»; просроченный шаг виден на карточке', async () => {
    await act(async () => root.render(<LeadsBoard rows={rows} onOpen={vi.fn()} onMove={vi.fn()} />));
    expect(ids('none')).toEqual([2, 3]);
    expect(ids('vbros')).toEqual([1]);
    expect(ids('deposit')).toEqual([4]);
    expect(column('deposit').querySelector('[data-testid="tile-next"]').dataset.state).toBe('overdue');
    expect(column('none').querySelector('[data-lead-id="3"]').getAttribute('draggable')).toBe('false');
  });

  it('перетаскивание в другой этап зовёт onMove; в «Без этапа» не бросить; щелчок открывает карточку', async () => {
    const onMove = vi.fn();
    const onOpen = vi.fn();
    await act(async () => root.render(<LeadsBoard rows={rows} onOpen={onOpen} onMove={onMove} />));
    const drag = (el) => {
      const ev = new Event('dragstart', { bubbles: true });
      ev.dataTransfer = { setData: vi.fn(), effectAllowed: '' };
      el.dispatchEvent(ev);
    };
    const drop = (el) => {
      const over = new Event('dragover', { bubbles: true, cancelable: true });
      over.dataTransfer = { dropEffect: '' };
      el.dispatchEvent(over);
      el.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }));
    };
    await act(async () => drag(column('vbros').querySelector('[data-lead-id="1"]')));
    await act(async () => drop(column('soglas')));
    expect(onMove).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), 'soglas');

    await act(async () => drag(column('vbros').querySelector('[data-lead-id="1"]')));
    await act(async () => drop(column('none')));
    expect(onMove).toHaveBeenCalledTimes(1);

    await act(async () => column('none').querySelector('[data-lead-id="2"]').click());
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }));
  });
});

describe('карточка лида', () => {
  const type = (el, value) => {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const card = () => document.querySelector('[data-testid="lead-card"]');
  const button = (text) => [...card().querySelectorAll('button')].find((b) => b.textContent.trim() === text);
  const draw = (extra, onChanged = vi.fn()) =>
    act(async () =>
      root.render(
        <LeadCard
          lead={lead(extra)}
          statusLabel="Написали"
          onClose={vi.fn()}
          onChanged={onChanged}
          onChat={vi.fn()}
          onQueue={vi.fn()}
          onUnqueue={vi.fn()}
          onDelete={vi.fn()}
        />,
      ),
    );

  it('следующий шаг сохраняется с датой; «Выполнено» его снимает', async () => {
    const onChanged = vi.fn();
    await draw({ telegram_user_id: 501 }, onChanged);
    await act(async () => type(card().querySelector('input[aria-label="Что сделать"]'), 'позвонить вечером'));
    await act(async () => type(card().querySelector('input[aria-label="Когда"]'), '2026-10-27T19:00'));
    await act(async () => button('Сохранить').click());
    expect(updateLead).toHaveBeenCalledWith(1, { next_step: 'позвонить вечером', next_step_at: fromLocalInput('2026-10-27T19:00') });
    expect(onChanged).toHaveBeenCalled();

    await draw({ telegram_user_id: 501, next_step: 'позвонить', next_step_at: 1 });
    expect(card().querySelector('[data-testid="card-next-when"]').textContent).toContain('просрочен');
    await act(async () => button('Выполнено').click());
    expect(updateLead).toHaveBeenLastCalledWith(1, { next_step: null, next_step_at: null });
  });

  it('заметка и этап сделки; без диалога этап выбрать нельзя', async () => {
    await draw({ telegram_user_id: 501 });
    await act(async () => type(card().querySelector('textarea[aria-label="Заметки"]'), 'перезвонить после 18'));
    await act(async () => button('Сохранить заметку').click());
    expect(updateLead).toHaveBeenCalledWith(1, { notes: 'перезвонить после 18' });

    const stage = card().querySelector('select');
    await act(async () => {
      stage.value = 'soglas';
      stage.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(setDealStage).toHaveBeenCalledWith(501, 'soglas', '');

    await draw({});
    expect(card().querySelector('select').disabled).toBe(true);
    expect(button('Открыть диалог')).toBeUndefined();
  });
});
