export const BARS = 36;

export function fmtClock(seconds) {
  const s = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function peaksFromSamples(samples, bars = BARS) {
  if (!samples || !samples.length) return fallbackPeaks('', bars);
  const size = Math.max(1, Math.floor(samples.length / bars));
  const raw = [];
  for (let b = 0; b < bars; b += 1) {
    let sum = 0;
    const start = b * size;
    const end = Math.min(samples.length, start + size);
    for (let i = start; i < end; i += 1) sum += samples[i] * samples[i];
    raw.push(Math.sqrt(sum / Math.max(1, end - start)));
  }
  const max = Math.max(...raw) || 1;
  return raw.map((v) => 0.12 + 0.88 * (v / max));
}

export function fallbackPeaks(seed, bars = BARS) {
  let h = 2166136261;
  for (const ch of String(seed)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const out = [];
  for (let b = 0; b < bars; b += 1) {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    out.push(0.25 + 0.6 * (((h >>> 0) % 1000) / 1000));
  }
  return out;
}

export function seekRatio(clientX, rect) {
  if (!rect || rect.width <= 0) return 0;
  return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
}
