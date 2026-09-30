import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import type { LoadedPersona } from 'src/brain/persona.service';

export type BeatScope = 'measured' | 'out_of_scope' | 'external_ssot';

export interface ConsoleBeat {
  id: string;
  title: string;
  day: number;
  scope: BeatScope;
}

export interface Rubric {
  beats: ConsoleBeat[];
  listed: ConsoleBeat[];
  measured: Set<string>;
  denominator: number;
  sha: string;
}

@Injectable()
export class RubricService {
  private readonly log = new Logger(RubricService.name);
  private readonly cache = new Map<
    string,
    { rubric: Rubric; updatedAt: number }
  >();

  of(persona: LoadedPersona): Rubric {
    const cached = this.cache.get(persona.slug);
    if (cached && cached.updatedAt === persona.updatedAt) return cached.rubric;

    const beats = persona.beats?.length
      ? this.fromBeats(persona.beats)
      : this.fromStorylines(persona.config.storylines);
    const measured = new Set(
      beats.filter((b) => b.scope === 'measured').map((b) => b.id),
    );
    const rubric: Rubric = {
      beats,
      listed: beats.filter((b) => b.scope !== 'external_ssot'),
      measured,
      denominator: measured.size,
      sha: createHash('sha256')
        .update(
          JSON.stringify(beats.map((b) => [b.id, b.title, b.day, b.scope])),
        )
        .digest('hex'),
    };
    this.cache.set(persona.slug, { rubric, updatedAt: persona.updatedAt });
    this.log.log(
      `rubric «${persona.slug}»: ${beats.length} beats, ${measured.size} measured`,
    );
    return rubric;
  }

  private fromBeats(raw: Record<string, unknown>[]): ConsoleBeat[] {
    return raw.map((b) => ({
      id: String(b.id),
      title: String(b.title),
      day: Number(b.day ?? 0),
      scope: (b.scope ?? 'measured') as BeatScope,
    }));
  }

  private fromStorylines(data: Record<string, any>): ConsoleBeat[] {
    const out: ConsoleBeat[] = [];
    (data?.lines ?? []).forEach((line: any, i: number) => {
      const beats: string[] = line.beats ?? [];
      out.push({
        id: `S${i + 1}`,
        title: `${line.id}: ${(beats[0] ?? '').slice(0, 80)}`,
        day: 1 + Math.floor(i / 3),
        scope: 'measured',
      });
    });
    (data?.episodes ?? []).forEach((ep: any, i: number) => {
      out.push({
        id: `E${i + 1}`,
        title: `${ep.id}: ${String(ep.text ?? '').slice(0, 80)}`,
        day: 0,
        scope: 'measured',
      });
    });
    return out;
  }
}
