import { describe, it, expect } from 'vitest';
import {
  PAUSE_REASON_SEP,
  pauseReasonDetail,
  pauseReasonHead,
  pauseReasonLabel,
} from './pauseReason';

const EVERY_REASON = [
  'bot_active',
  'human_takeover',
  'operator_hold',
  'ceiling_halt',
  'paused',
];

describe('pauseReasonHead', () => {
  it('голова каждого состояния — оно само (путь при выключенном флаге прежний)', () => {
    for (const reason of EVERY_REASON) {
      expect(pauseReasonHead(reason)).toBe(reason);
      expect(pauseReasonDetail(reason)).toBe(null);
    }
  });

  it('хвост отрезается по ПЕРВОМУ разделителю', () => {
    expect(pauseReasonHead('human_takeover:empty_after_critic/p0_persisted')).toBe(
      'human_takeover',
    );
  });

  it('второе двоеточие остаётся в хвосте, а не режет голову', () => {
    expect(pauseReasonHead('human_takeover:a:b')).toBe('human_takeover');
    expect(pauseReasonDetail('human_takeover:a:b')).toBe('a:b');
  });

  it('разделитель тот же, что у бэка', () => {
    expect(PAUSE_REASON_SEP).toBe(':');
  });

  it('пусто и null не роняют разбор', () => {
    expect(pauseReasonHead(null)).toBe('');
    expect(pauseReasonDetail(undefined)).toBe(null);
  });
});

describe('pauseReasonDetail', () => {
  it('вердикт отдаётся целиком', () => {
    expect(pauseReasonDetail('human_takeover:empty_after_critic/p0_persisted')).toBe(
      'empty_after_critic/p0_persisted',
    );
  });

  it('пустой хвост — это отсутствие вердикта, а не пустая строка на экране', () => {
    expect(pauseReasonDetail('human_takeover:')).toBe(null);
    expect(pauseReasonDetail('human_takeover:   ')).toBe(null);
  });
});

describe('pauseReasonLabel', () => {
  it('каждое состояние названо по-русски и НЕ равно своему коду', () => {
    for (const reason of EVERY_REASON) {
      expect(pauseReasonLabel(reason)).not.toBe(reason);
      expect(pauseReasonLabel(reason).length).toBeGreaterThan(0);
    }
  });

  it('разные состояния подписаны РАЗНО', () => {
    expect(new Set(EVERY_REASON.map(pauseReasonLabel)).size).toBe(EVERY_REASON.length);
  });

  it('подпись берётся по ГОЛОВЕ, хвост её не сбивает', () => {
    expect(pauseReasonLabel('human_takeover:empty_after_critic/p0_persisted')).toBe(
      pauseReasonLabel('human_takeover'),
    );
  });

  it('незнакомое состояние показывается КАК ЕСТЬ, а не прячется', () => {
    expect(pauseReasonLabel('brand_new_state:почему')).toBe('brand_new_state');
  });
});
