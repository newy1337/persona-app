import { createHash } from 'node:crypto';
import type {
  CharacterState,
  Storyline,
  StorylineProgress,
} from '../kernel/types';
import { asInt } from '../kernel/coerce';
import { daysBetween, parseDate, shiftDate } from '../kernel/clock';

const DEFAULT_ROTATION_DAYS = 14;

export function storylineThresholds(
  line: Record<string, any>,
  beatDays: number,
): number[] {
  const beats: unknown[] = line['beats'] ?? [];
  const configured: unknown[] = line['beat_after_days'] ?? [];
  if (configured.length === beats.length) {
    const thresholds = configured.map((value) => Math.max(0, asInt(value)));
    const ascending = thresholds.every(
      (value, index) => index === 0 || value >= thresholds[index - 1]!,
    );
    if (ascending) return thresholds;
  }
  return beats.map((_, index) => index * beatDays);
}

export function activeStorylines(
  storylines: Record<string, any>,
  character: CharacterState,
  today: string,
): Storyline[] {
  const lines: Array<Record<string, any>> = storylines['lines'] ?? [];
  if (lines.length === 0) return [];

  const defaultStart = parseDate(character.storyline_started) || today;
  const beatDays = Math.max(1, asInt(storylines['beat_days']));
  const rotationDays = Math.max(
    1,
    asInt(storylines['rotation_days']) || DEFAULT_ROTATION_DAYS,
  );
  const showCount = Math.min(
    lines.length,
    Math.max(1, asInt(storylines['show_at_once'])),
  );
  const progress: Record<string, StorylineProgress> =
    (character.storyline_progress ??= {});
  let cursor = asInt(character.storyline_cursor);

  if (Object.keys(progress).length === 0) {
    const digest = createHash('sha256')
      .update(character.first_seen ?? today)
      .digest();
    cursor = Number(digest.readBigUInt64BE(0) % BigInt(lines.length));
    character.storyline_cursor = cursor;
    for (let offset = 0; offset < showCount; offset += 1) {
      const line = lines[(cursor + offset) % lines.length]!;
      progress[String(line['id'])] = {
        started_on: shiftDate(defaultStart, offset),
        completed: false,
      };
    }
  }

  const byId = new Map(lines.map((line) => [String(line['id']), line]));

  for (const [lineId, item] of Object.entries(progress)) {
    const line = byId.get(lineId);
    if (!line || item.completed) continue;
    const startedOn = parseDate(item.started_on) || defaultStart;
    const thresholds = storylineThresholds(line, beatDays);
    if (
      daysBetween(startedOn, today) >=
      thresholds[thresholds.length - 1]! + rotationDays
    ) {
      item.completed = true;
    }
  }

  const openCount = () =>
    Object.values(progress).filter((item) => !item.completed).length;
  for (
    let attempts = 0;
    openCount() < showCount && attempts < lines.length;
    attempts += 1
  ) {
    cursor = (cursor + 1) % lines.length;
    character.storyline_cursor = cursor;
    const lineId = String(lines[cursor]!['id']);
    if (lineId in progress) continue;
    progress[lineId] = { started_on: today, completed: false };
  }

  const active: Storyline[] = [];
  for (const [lineId, item] of Object.entries(progress) as Array<
    [string, StorylineProgress]
  >) {
    if (item.completed) continue;
    const line = byId.get(lineId);
    if (!line) continue;
    const beats: string[] = line['beats'] ?? [];
    if (beats.length === 0) continue;
    const startDate = parseDate(item.started_on) || defaultStart;
    if (today < startDate) continue;
    const elapsedDays = Math.max(0, daysBetween(startDate, today));
    const thresholds = storylineThresholds(line, beatDays);
    let beat = 0;
    thresholds.forEach((threshold, index) => {
      if (elapsedDays >= threshold) beat = index;
    });
    item.beat = beat;
    active.push({
      kind: 'personal_event_not_profession',
      id: String(line['id']),
      current: beats[beat]!,
      previous: beat ? beats[beat - 1]! : '',
    });
  }
  return active.slice(0, showCount);
}

export function pastEpisodes(
  persona: Record<string, any>,
  storylines: Record<string, any>,
): Storyline[] {
  const fromPersona: Storyline[] = (persona['stories'] ?? [])
    .filter(
      (item: any) =>
        item &&
        typeof item === 'object' &&
        typeof item.id === 'string' &&
        item.id &&
        typeof item.story === 'string' &&
        item.story.trim(),
    )
    .map((item: any) => ({
      kind: 'past_episode',
      id: `persona:${item.id}`,
      current: item.story,
      previous: '',
      topics: item.topics ?? [],
    }));

  const fromEpisodes: Storyline[] = (storylines['episodes'] ?? []).map(
    (item: any) => ({
      kind: 'past_episode',
      id: String(item.id),
      current: String(item.text),
      previous: '',
    }),
  );

  return [...fromPersona, ...fromEpisodes];
}
