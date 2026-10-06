import { useNavigate } from 'react-router-dom';
import { Bot, Clock, OctagonAlert, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Attribution } from '../Attribution/Attribution';
import { PRIORITY_COLORS, priorityColor } from '../../data/stages';

function waitingFor(ts) {
  if (!ts) return '—';
  const mins = Math.max(0, Math.floor(Date.now() / 1000 - ts) / 60);
  if (mins < 60) return `${Math.floor(mins)} мин`;
  const hours = mins / 60;
  return hours < 24 ? `${Math.floor(hours)} ч` : `${Math.floor(hours / 24)} д`;
}

export const REASON_LABEL = {
  hold_armed: 'Передать аналитика',
  manual_takeover: 'Бот замолчал',
  before_soglas: 'Сейчас соглас',
  before_predloga: 'Сейчас предлога',
  before_vbros: 'Сейчас вброс',
  vbros_ready: 'Пора вбрасывать',
  qual_gap: 'Данные не собраны',
  media_voice: 'Просит голосовое',
  media_photo: 'Просит фото',
  media_video_note: 'Просит кружок',
  media_video: 'Просит видео',
  trigger_phrase: 'Стоп-фраза клиента',
  manual_mode: 'Ручной режим',
};

function AgentCard({ agent, showAlert = false }) {
  const {
    chat_id: chatId,
    account_id: accountId,
    account_username: accountUsername,
    name,
    age,
    city,
    vbros_phase: vbrosPhase,
    is_paused: isPaused,
    hold_armed_at: holdArmedAt,
    queue_reason: queueReason,
    waiting_since: waitingSince,
  } = agent;
  const isManager = Boolean(isPaused);
  const navigate = useNavigate();
  const open = () => navigate(`/conversation/${chatId}`);
  const onKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      open();
    }
  };
  const reason = showAlert ? REASON_LABEL[queueReason] : null;
  const urgent = String(queueReason).startsWith('media_');
  const hot = priorityColor(vbrosPhase) === PRIORITY_COLORS.hot;
  const LeadIcon = isManager ? User : Bot;

  return (
    <Card
      data-testid="agent-card"
      role="link"
      tabIndex={0}
      onClick={open}
      onKeyDown={onKeyDown}
      className={cn(
        'agentCard',
        'min-w-0 cursor-pointer gap-3 rounded-lg p-4 shadow-none outline-none transition-colors hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-sm font-medium">{name || `Чат ${chatId}`}</span>
          <div className="flex min-h-4 items-center gap-1.5 overflow-hidden text-xs text-muted-foreground">
            {age || city ? (
              <>
                {age ? <span className="shrink-0">{age} лет</span> : null}
                {age && city ? <span className="shrink-0">·</span> : null}
                {city ? <span className="truncate" title={city}>{city}</span> : null}
              </>
            ) : (
              <span className="truncate">
                {accountId == null ? 'аккаунт удалён' : accountUsername ? `@${accountUsername}` : 'возраст и город неизвестны'}
              </span>
            )}
          </div>
        </div>
        {showAlert && vbrosPhase ? (
          <span
            className={cn('shrink-0', hot ? 'text-destructive' : 'text-muted-foreground')}
            title={`Вброс: ${vbrosPhase}`}
          >
            <OctagonAlert aria-hidden="true" className="size-4" />
          </span>
        ) : null}
      </div>

      <Attribution value={agent} compact />

      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-1.5">
          <Badge variant="outline" className="font-normal">
            <LeadIcon aria-hidden="true" />
            {isManager ? 'Менеджер' : 'Бот'}
          </Badge>
          {reason && (
            <Badge variant={urgent ? 'destructive' : 'warning'} title={reason} className="min-w-0 shrink font-normal">
              <span className="truncate">{reason}</span>
            </Badge>
          )}
        </div>

        <span className="flex shrink-0 items-center gap-1 whitespace-nowrap text-xs text-muted-foreground">
          <Clock aria-hidden="true" className="size-3.5" />
          <span className="min-w-[4ch] text-right tabular-nums">{waitingFor(waitingSince ?? holdArmedAt)}</span>
        </span>
      </div>
    </Card>
  );
}

export default AgentCard;
