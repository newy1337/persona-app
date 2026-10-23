// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { MeContext } from '../AppLayout/me';

vi.mock('./VoiceNotifications', () => ({ default: () => <span data-testid="notifications" /> }));
vi.mock('../../api/stats', () => ({ getStats: vi.fn(async () => ({ active_now: 0 })) }));

import Header from './Header';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host, root;
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

const draw = (me) => act(async () => root.render(
  <MemoryRouter><MeContext.Provider value={me}><Header /></MeContext.Provider></MemoryRouter>,
));

test('уведомления видит менеджер, у админа их нет', async () => {
  await draw({ id: 2, username: 'm', role: 'manager' });
  expect(host.querySelector('[data-testid="notifications"]')).not.toBeNull();
  await draw({ id: 1, username: 'admin', role: 'admin' });
  expect(host.querySelector('[data-testid="notifications"]')).toBeNull();
});
