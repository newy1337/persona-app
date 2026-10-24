export function normalizeMemoryText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_]+/gu, ' ')
    .trim();
}

export function tokens(value: string): Set<string> {
  return new Set(value.toLowerCase().match(/[\p{L}\p{N}_-]{3,}/gu) ?? []);
}

export function intersectionSize(
  left: Set<string>,
  right: Set<string>,
): number {
  let count = 0;
  const [small, large] =
    left.size <= right.size ? [left, right] : [right, left];
  for (const item of small) if (large.has(item)) count += 1;
  return count;
}
