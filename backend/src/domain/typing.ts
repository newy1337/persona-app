export interface TypingStyle {
  enabled: boolean;
  chars_per_second: number;
  min_seconds: number;
  part_pause_min: number;
  part_pause_max: number;
}

export const DEFAULT_TYPING: TypingStyle = {
  enabled: true,
  chars_per_second: 12,
  min_seconds: 1.5,
  part_pause_min: 1.5,
  part_pause_max: 4,
};

export const TYPING_REFRESH_MS = 4000;

const between = (lo: number, hi: number, random: () => number) =>
  lo + (hi - lo) * random();

export function typingMs(
  text: string,
  style: TypingStyle,
  random: () => number = Math.random,
): number {
  const cps = Math.max(1, style.chars_per_second);
  return Math.max(
    style.min_seconds * 1000,
    (String(text ?? '').length / cps) * 1000 * between(0.75, 1.3, random),
  );
}

export interface TypingPlan {
  bursts: number[];
  pauses: number[];
}

export function typingPlan(
  text: string,
  style: TypingStyle,
  random: () => number = Math.random,
): TypingPlan {
  const ms = typingMs(text, style, random);
  const count = ms < 2500 ? 1 : ms < 8000 ? 2 : 3;
  const bursts: number[] = [];
  const pauses: number[] = [];
  for (let b = 0; b < count; b += 1) {
    const share = count === 1 ? 1 : b === 0 ? 0.55 : 0.45 / (count - 1);
    bursts.push(Math.round(Math.max(700, ms * share)));
    if (b < count - 1)
      pauses.push(Math.round(between(0.8, 2.2, random) * 1000));
  }
  return { bursts, pauses };
}

export function partPauseMs(
  style: TypingStyle,
  random: () => number = Math.random,
): number {
  const lo = Math.min(style.part_pause_min, style.part_pause_max);
  const hi = Math.max(style.part_pause_min, style.part_pause_max);
  return Math.round(between(lo, hi, random) * 1000);
}
