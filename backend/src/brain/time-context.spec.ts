import { NastyaBrainService } from './nastya-brain.service';
import { cityPlace } from './nastya/kernel/location';

describe('часы хода не зависят от определения места', () => {
  const brain = (persona: Record<string, unknown>) => {
    const svc: any = Object.create(NastyaBrainService.prototype);
    Object.assign(svc, {
      persona: {
        interlocutorLocation: async () => cityPlace('Madrid', 'ES'),
        ...persona,
      },
      clock: { now: () => new Date('2026-10-02T10:00:00Z') },
      log: { warn: jest.fn(), log: jest.fn(), error: jest.fn() },
    });
    return svc;
  };

  const loaded = { rhythm: { timezone: 'Asia/Bangkok' }, variables: {} } as any;
  const state = { character: { slots: {} } } as any;

  it('город подставляется в собственные часы', async () => {
    const svc = brain({
      personaPlace: async () => cityPlace('Phuket', 'TH'),
    });
    const time = await svc.timeContext(loaded, state);
    expect(time.persona).toMatchObject({ city: 'Phuket', time: '17:00' });
  });

  it('упавшее определение места не срывает ход — часы остаются', async () => {
    const svc = brain({
      personaPlace: async () => {
        throw new Error('модель не ответила');
      },
    });
    const time = await svc.timeContext(loaded, state);
    expect(time.persona).toMatchObject({
      city: '',
      timezone: 'Asia/Bangkok',
      time: '17:00',
    });
  });

  it('сервис без определения места (старый стенд) тоже отвечает', async () => {
    const svc = brain({});
    const time = await svc.timeContext(loaded, state);
    expect(time.persona).toMatchObject({
      city: '',
      timezone: 'Asia/Bangkok',
      time: '17:00',
    });
  });

  it('неизвестный город собеседника не ломает разницу', async () => {
    const svc = brain({
      interlocutorLocation: async () => {
        throw new Error('нет связи');
      },
      personaPlace: async () => cityPlace('Phuket', 'TH'),
    });
    const time = await svc.timeContext(loaded, state);
    expect(time.interlocutor.hour).toBeNull();
    expect(time.persona_ahead_minutes).toBeNull();
    expect(time.persona.time).toBe('17:00');
  });
});
