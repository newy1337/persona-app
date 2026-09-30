export const VALID_FUNNEL_STAGES = [
  'cold',
  'rapport',
  'pain',
  'close',
  'post_lead',
] as const;
export type FunnelStage = (typeof VALID_FUNNEL_STAGES)[number];
export const DEFAULT_FUNNEL_STAGE: FunnelStage = 'cold';

export const isFunnelStage = (value: unknown): value is FunnelStage =>
  typeof value === 'string' &&
  (VALID_FUNNEL_STAGES as readonly string[]).includes(value);

export const ACQUAINTANCE_TO_FUNNEL: Record<string, FunnelStage> = {
  knock: 'cold',
  smalltalk: 'cold',
  warm: 'rapport',
  familiar: 'pain',
  close: 'close',
};
