import { NastyaBrainService } from './nastya-brain.service';
import { PersonaService } from './persona.service';
import { REFUSAL_LOCK_KEY } from 'src/domain/lead-facts';

function brain() {
  const b: any = Object.create(NastyaBrainService.prototype);
  Object.assign(b, {
    gate: { stopped: false },
    pause: { status: async () => ({ status: 'active' }), pause: jest.fn() },
    history: {
      getLeadFacts: async () => ({}),
      isBlockedByClient: async () => false,
    },
    persona: { forAccount: async () => ({ enabled: true }) },
  });
  return b;
}
it.each(['stopped', 'paused', 'refused', 'blocked', 'persona'])(
  'shared send gate blocks %s',
  async (reason) => {
    const b = brain();
    if (reason === 'stopped') b.gate.stopped = true;
    if (reason === 'paused')
      b.pause.status = async () => ({ status: 'paused' });
    if (reason === 'refused')
      b.history.getLeadFacts = async () => ({ [REFUSAL_LOCK_KEY]: true });
    if (reason === 'blocked') b.history.isBlockedByClient = async () => true;
    if (reason === 'persona')
      b.persona.forAccount = async () => ({ enabled: false });
    expect(await b.automationBlock(1, 2)).toBe(reason);
  },
);
it('missing binding stops automatic replies instead of borrowing another persona', async () => {
  const p: any = Object.create(PersonaService.prototype);
  Object.assign(p, {
    chatVars: async () => ({}),
    prisma: {
      tgAccount: { findUnique: async () => ({ personaId: 'deleted' }) },
      persona: { findUnique: async () => null },
    },
    defaultRow: jest.fn(),
  });
  await expect(p.forAccount(1, 2)).rejects.toThrow('не найдена');
  expect(p.defaultRow).not.toHaveBeenCalled();
});
it('unknown automatic location produces an actionable hold instead of guessed local time', async () => {
  const b = brain();
  b.persona.forAccount = async () => ({
    enabled: true,
    locationIssue: 'Укажите текущее место',
  });
  expect(await b.automationBlock(1, 2)).toBe('persona');
  expect(b.pause.pause).toHaveBeenCalledWith(
    1,
    expect.anything(),
    'system:persona_location',
    { reasonText: 'Укажите текущее место' },
  );
});
