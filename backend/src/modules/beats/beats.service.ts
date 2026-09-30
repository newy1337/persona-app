import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma.service';
import { HistoryService } from 'src/shared/history.service';
import { PersonaService } from 'src/brain/persona.service';
import { toChatId } from 'src/utils/ids';
import { RubricService } from './rubric.service';

export const STATUS_DELIVERED = 'delivered';
export const STATUS_REJECTED = 'rejected';
export const STATUS_UNKNOWN = 'unknown';
export const STATUS_OUT_OF_SCOPE = 'out_of_scope';

const TAIL_SHOWN_KEY = '_beat_tail_shown';
const TOUCH_CAP = 3;

@Injectable()
export class BeatsService {
  constructor(
    private prisma: PrismaService,
    private history: HistoryService,
    private rubric: RubricService,
    private persona: PersonaService,
  ) {}

  private async rubricOf(chatId: number) {
    const persona = await this.persona.forChat(chatId);
    return { slug: persona.slug, rubric: this.rubric.of(persona) };
  }

  private async rows(chatId: number, slug: string) {
    const list = await this.prisma.beatDelivery.findMany({
      where: { personaId: slug, chatId: toChatId(chatId) },
      orderBy: { beat: 'asc' },
    });
    return new Map(list.map((r) => [r.beat, r]));
  }

  async snapshot(chatId: number, withStalled = true) {
    const { slug, rubric } = await this.rubricOf(chatId);
    const byId = await this.rows(chatId, slug);
    const measured = rubric.measured;
    let shown: Record<string, number> = {};
    if (withStalled) {
      try {
        const raw = (await this.history.getLeadFacts(chatId))[TAIL_SHOWN_KEY];
        if (raw && typeof raw === 'object') {
          shown = Object.fromEntries(
            Object.entries(raw as Record<string, unknown>).filter(([, v]) =>
              Number.isInteger(v),
            ),
          ) as Record<string, number>;
        }
      } catch {
        shown = {};
      }
    }
    const beats = rubric.listed.map((b) => {
      if (b.scope === 'out_of_scope') {
        return {
          id: b.id,
          title: b.title,
          status: STATUS_OUT_OF_SCOPE,
          by: null,
          src: null,
          ts: null,
          turn: null,
          day: null,
          actor: null,
          evidence: null,
          stalled: false,
          stalled_reason: null,
          reason: null,
        };
      }
      const row = byId.get(b.id);
      if (!row || row.status !== STATUS_DELIVERED) {
        const stalled = !row && (shown[b.id] ?? 0) >= TOUCH_CAP;
        return {
          id: b.id,
          title: b.title,
          status: STATUS_UNKNOWN,
          by: null,
          src: null,
          ts: null,
          turn: null,
          day: b.day,
          actor: null,
          evidence: null,
          stalled,
          stalled_reason: stalled ? 'touch_cap_exhausted' : null,
          reason: null,
        };
      }
      return {
        id: b.id,
        title: b.title,
        status: STATUS_DELIVERED,
        by: row.by,
        src: row.src,
        ts: row.ts,
        turn: row.turn,
        day: b.day,
        actor: row.actor,
        evidence: row.evidence || null,
        stalled: false,
        stalled_reason: null,
        reason: row.reason || null,
      };
    });
    const delivered = beats.filter(
      (b) => b.status === STATUS_DELIVERED && measured.has(b.id),
    ).length;
    return { chat_id: chatId, total: rubric.denominator, delivered, beats };
  }

  async recordAuto(
    chatId: number,
    beat: string,
    by: string,
    src: string,
    ts: number,
    evidence = '',
    reason = '',
  ) {
    try {
      const { slug, rubric } = await this.rubricOf(chatId);
      await this.prisma.beatDelivery.create({
        data: {
          personaId: slug,
          chatId: toChatId(chatId),
          beat,
          status: STATUS_DELIVERED,
          ts,
          by,
          src,
          evidence,
          reason,
          rubricSha: rubric.sha,
        },
      });
      return true;
    } catch {
      return false;
    }
  }

  async recordManager(
    chatId: number,
    beat: string,
    verdict: 'confirmed' | 'rejected',
    actor: string,
    ts: number,
  ) {
    const status = verdict === 'confirmed' ? STATUS_DELIVERED : STATUS_REJECTED;
    const { slug, rubric } = await this.rubricOf(chatId);
    const key = { personaId: slug, chatId: toChatId(chatId), beat };
    await this.prisma.beatDelivery.upsert({
      where: { personaId_chatId_beat: key },
      create: {
        ...key,
        status,
        ts,
        by: 'manager',
        src: 'manager_confirm',
        actor,
        rubricSha: rubric.sha,
      },
      update: { status, by: 'manager', src: 'manager_confirm', actor, ts },
    });
  }

  async confirm(
    chatId: number,
    operator: string,
    confirmed: string[],
    rejected: string[],
    ts: number,
  ) {
    const { slug, rubric } = await this.rubricOf(chatId);
    const rows = await this.rows(chatId, slug);
    const measured = rubric.measured;
    let written = 0;
    let skipped = 0;
    for (const id of confirmed) {
      const row = rows.get(id);
      if (!measured.has(id) || (row && row.status === STATUS_DELIVERED)) {
        skipped += 1;
        continue;
      }
      await this.recordManager(chatId, id, 'confirmed', operator, ts);
      written += 1;
    }
    for (const id of rejected) {
      if (!measured.has(id)) continue;
      await this.recordManager(chatId, id, 'rejected', operator, ts);
    }
    const snap = await this.snapshot(chatId, false);
    return { written, skipped, total: snap.total, delivered: snap.delivered };
  }
}
