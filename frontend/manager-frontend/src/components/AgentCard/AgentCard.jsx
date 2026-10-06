import { useNavigate } from 'react-router-dom';
import { Clock, OctagonAlert, Zap } from 'lucide-react';
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

  return (
    <Card
      data-testid="agent-card"
      role="link"
      tabIndex={0}
      onClick={open}
      onKeyDown={onKeyDown}
      className={cn(
        'agentCard',
        'min-w-0 cursor-pointer gap-3.5 rounded-lg p-4 shadow-none transition-colors hover:border-foreground/25',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="truncate text-sm font-semibold">{name || `Чат ${chatId}`}</span>
          <div className="flex min-h-4 items-center gap-2 overflow-hidden text-xs text-muted-foreground">
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
            <OctagonAlert className="size-5" />
          </span>
        ) : null}
      </div>

      <Attribution value={agent} compact />

      {showAlert && (
        <div className="-mt-1 flex min-h-5 items-start">
          {reason && (
            <Badge
              variant="outline"
              title={reason}
              className={cn(
                'h-5 max-w-full rounded-full font-medium',
                urgent && 'border-destructive/35 bg-destructive/10 text-destructive',
              )}
            >
              <span className="truncate">{reason}</span>
            </Badge>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-3 border-t pt-2.5">
        {isManager ? (
          <Badge variant="default" className="h-5 rounded-full">
            <Zap />
            Менеджер
          </Badge>
        ) : (
          <Badge variant="secondary" className="h-5 rounded-full">
            <Zap />
            Бот
          </Badge>
        )}

        <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-muted-foreground">
          <Clock className="size-3.5" />
          <span className="min-w-[4ch] text-right font-mono text-sm font-medium tabular-nums text-foreground">
            {waitingFor(waitingSince ?? holdArmedAt)}
          </span>
        </span>
      </div>
    </Card>
  );
}

export default AgentCard;
