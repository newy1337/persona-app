import { Test } from '@nestjs/testing';
import { PauseService } from './pause.service';
import { HistoryService } from './history.service';
import { ClockService } from './clock.service';
import { FunnelEventsService } from './funnel-events.service';
import { TakeoverReason } from '../domain/pause';
import { PrismaService } from '../prisma.service';

describe('PauseService', () => {
  let service: PauseService;
  let state: any;
  const history = {
    acknowledgeManualReview: jest.fn(async () => undefined),
    getPause: jest.fn(async () => state),
    setPause: jest.fn(async (_id: number, next: any) => {
      state = next;
    }),
    mergeLeadFacts: jest.fn(async () => ({})),
  };
  const funnel = { emit: jest.fn(async () => undefined) };

  beforeEach(async () => {
    state = {
      status: 'active',
      reason: 'bot_active',
      actor: null,
      until: null,
      ts: null,
    };
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        PauseService,
        {
          provide: PrismaService,
          useValue: { voiceCall: { findFirst: jest.fn(async () => null) } },
        },
        { provide: HistoryService, useValue: history },
        { provide: ClockService, useValue: { ts: () => 1000 } },
        { provide: FunnelEventsService, useValue: funnel },
      ],
    }).compile();
    service = moduleRef.get(PauseService);
  });

  it('pauses with a typed reason and emits one event', async () => {
    await service.pause(1, TakeoverReason.HOLD, 'operator:web');
    expect(history.setPause).toHaveBeenCalledWith(1, {
      status: 'paused',
      reason: 'operator_hold',
      actor: 'operator:web',
      ts: 1000,
      until: null,
    });
    expect(funnel.emit).toHaveBeenCalledWith(1, 'conversation_paused', 1000, {
      reason: 'operator_hold',
      actor: 'operator:web',
    });
  });

  it('is idempotent for the same reason and actor', async () => {
    await service.pause(1, TakeoverReason.HOLD, 'operator:web');
    await service.pause(1, TakeoverReason.HOLD, 'operator:web');
    expect(history.setPause).toHaveBeenCalledTimes(1);
    expect(funnel.emit).toHaveBeenCalledTimes(1);
  });

  it('keeps the free-text tail behind the head', async () => {
    await service.pause(1, TakeoverReason.MANUAL_TAKEOVER, 'admin', {
      reasonText: 'звонок',
    });
    expect(state.reason).toBe('human_takeover:звонок');
  });

  it('forbids an auto-resume ceiling on manual takeover', async () => {
    await expect(
      service.pause(1, TakeoverReason.MANUAL_TAKEOVER, 'admin', {
        until: 2000,
      }),
    ).rejects.toThrow(/MANUAL_TAKEOVER/);
  });

  it('resume on an active chat is a no-op', async () => {
    await service.resume(1, 'operator:web');
    expect(history.setPause).not.toHaveBeenCalled();
    expect(funnel.emit).not.toHaveBeenCalled();
  });

  it('resume clears the reason and the ceiling', async () => {
    await service.pause(1, TakeoverReason.PERSONA_AWAY, 'brain', {
      until: 5000,
    });
    await service.resume(1, 'system:auto_resume');
    expect(state).toEqual({
      status: 'active',
      reason: 'bot_active',
      actor: 'system:auto_resume',
      ts: 1000,
      until: null,
    });
    expect(funnel.emit).toHaveBeenLastCalledWith(
      1,
      'conversation_resumed',
      1000,
      { actor: 'system:auto_resume' },
    );
  });
});
