import {
  ConflictException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PauseService } from 'src/shared/pause.service';
import { HistoryService } from 'src/shared/history.service';
import { ClockService } from 'src/shared/clock.service';
import { TakeoverReason } from 'src/domain/pause';

export const RELAY_ACTION = 'relay_operator_text';
const MAX_RELAY_CHARS = 4000;

export interface TakeoverTicket {
  persona: string;
  chat: number;
  operator: string;
  issued_ts: number;
}

@Injectable()
export class OperatorService {
  private readonly holders = new Map<number, TakeoverTicket>();
  private readonly byOperator = new Map<string, number>();

  constructor(
    private pause: PauseService,
    private history: HistoryService,
    private clock: ClockService,
  ) {}

  async takeover(
    persona: string,
    chat: number,
    operator: string,
  ): Promise<TakeoverTicket> {
    const held = this.holders.get(chat);
    if (held && held.operator !== operator) {
      throw new ConflictException(
        `чат ${chat} занят оператором ${held.operator}`,
      );
    }
    if (held) return held;
    const busy = this.byOperator.get(operator);
    if (busy !== undefined && busy !== chat) {
      throw new ConflictException(
        `оператор ${operator} уже держит чат ${busy}`,
      );
    }
    await this.pause.pause(
      chat,
      TakeoverReason.MANUAL_TAKEOVER,
      `operator:${operator}`,
    );
    const ticket: TakeoverTicket = {
      persona,
      chat,
      operator,
      issued_ts: this.clock.now().getTime() / 1000,
    };
    this.holders.set(chat, ticket);
    this.byOperator.set(operator, chat);
    return ticket;
  }

  requireActive(ticket: TakeoverTicket): void {
    const held = this.holders.get(ticket.chat);
    if (
      !held ||
      held.operator !== ticket.operator ||
      held.issued_ts !== ticket.issued_ts
    ) {
      throw new UnprocessableEntityException(
        'relay/resume без активного тикета — reject',
      );
    }
  }

  async relayText(ticket: TakeoverTicket, text: string): Promise<number> {
    this.requireActive(ticket);
    const clean = text.trim().slice(0, MAX_RELAY_CHARS);
    if (!clean)
      throw new UnprocessableEntityException('пустой relay-текст — reject');
    const payload = JSON.stringify({
      text: clean,
      operator: ticket.operator,
      persona: ticket.persona,
    });
    return this.history.enqueueAdminAction(ticket.chat, RELAY_ACTION, payload);
  }

  async resume(ticket: TakeoverTicket): Promise<void> {
    this.requireActive(ticket);
    await this.pause.resume(ticket.chat, `operator:${ticket.operator}`);
    this.holders.delete(ticket.chat);
    this.byOperator.delete(ticket.operator);
  }

  status(chat: number) {
    return this.pause.status(chat);
  }

  async pending(chat: number) {
    const rows = await this.history.pendingAdminActions(chat);
    return rows.map((a) => ({
      id: a.id,
      chat: Number(a.chatId),
      action: a.action,
      status: a.status,
      created_ts: a.createdTs,
    }));
  }
}
