// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn(), useParams: () => ({ id: '1' }), Link: () => null, NavLink: () => null }));
const { pickerPlacement } = await import('./ConversationPage');

describe('pickerPlacement: где открыть панель реакций', () => {
  const viewport = { width: 1280, height: 800 };

  it('сверху хватает места — над кнопкой', () => {
    expect(pickerPlacement({ left: 400, top: 600, bottom: 622 }, viewport)).toEqual({ left: 400, bottom: 206 });
  });

  it('кнопка у верха экрана — под ней', () => {
    expect(pickerPlacement({ left: 400, top: 120, bottom: 142 }, viewport)).toEqual({ left: 400, top: 148 });
  });

  it('у правого края — не вылезает за окно', () => {
    expect(pickerPlacement({ left: 1250, top: 600, bottom: 622 }, viewport).left).toBe(1280 - 272 - 8);
  });
});
