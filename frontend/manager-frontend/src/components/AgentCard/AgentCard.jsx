import { useNavigate } from 'react-router-dom';
import { Clock, OctagonAlert, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useIsAdmin } from '../AppLayout/me';
import { Badge } from '@/components/ui/badge';
import ClientAvatar, { ACTIVITY_LABEL } from '../ClientAvatar/ClientAvatar';
import { PRIORITY_COLORS, priorityColor, stageColors } from '../../data/stages';

function waitingFor(ts) {
  if (!ts) return '—';
  const mins = Math.max(0, Math.floor(Date.now() / 1000 - ts) / 60);
  if (mins < 60) return `${Math.floor(mins)} мин`;
  const hours = mins / 60;
  return hours < 24 ? `${Math.floor(hours)} ч` : `${Math.floor(hours / 24)} д`;
}

function years(age) {
  const n = Math.abs(Number(age)) % 100;
  const d = n % 10;
  if (n > 10 && n < 20) return `${age} лет`;
  if (d === 1) return `${age} год`;
  if (d >= 2 && d <= 4) return `${age} года`;
  return `${age} лет`;
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

/**
 * Сетка строки. Колонки после имени — фиксированной ширины, поэтому строки
 * одного столбца стоят ровно, как таблица. В узком столбце (container query по
 * ячейке списка) сначала уходит логин менеджера, потом стадия.
 *
 * Колонки «кто ведёт» нет: отвечать должен
 * менеджер, это и так понятно. Админу вместо неё показан логин менеджера,
 * за которым закреплён диалог.
 */
const QUEUE_GRID =
  'grid-cols-[minmax(0,1fr)_132px_52px] @min-[480px]:grid-cols-[minmax(0,1fr)_132px_120px_52px]';
const QUEUE_GRID_ADMIN =
  'grid-cols-[minmax(0,1fr)_132px_52px] @min-[480px]:grid-cols-[minmax(0,1fr)_132px_120px_52px] @min-[620px]:grid-cols-[minmax(0,1fr)_132px_120px_120px_52px]';
export const ROW_HEIGHT = 'h-10';

/** Строка очереди «Ждут менеджера»: одна линия 40px. */
function AgentCard({ agent }) {
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
    manager_username: managerUsername,
    region_code: regionCode,
    client_presence: clientPresence,
    avatar_url: avatarUrl,
    typing,
    stage,
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
  const reason = REASON_LABEL[queueReason];
  const urgent = String(queueReason).startsWith('media_');
  const hot = priorityColor(vbrosPhase) === PRIORITY_COLORS.hot;
  const lead = isManager ? 'Менеджер' : 'Бот';
  // Чей это диалог, интересно только админу: менеджер видит лишь свои.
  const admin = useIsAdmin();
  const online = clientPresence?.kind === 'online';

  const who = name || `Чат ${chatId}`;
  const about =
    [age ? years(age) : null, city].filter(Boolean).join(' · ') ||
    (accountId == null ? 'аккаунт удалён' : accountUsername ? `@${accountUsername}` : 'возраст и город неизвестны');
  const activity = typing ? `${ACTIVITY_LABEL[typing] || 'печатает'}…` : null;
  const time = waitingFor(waitingSince ?? holdArmedAt);
  const stageTitle = stage?.title ? `${stage.title} · этап ${stage.index} из ${stage.total}` : null;

  // Всё, что на узкой панели прячется, остаётся в подсказке строки.
  const title = [
    who,
    about,
    online ? 'в сети' : null,
    reason,
    vbrosPhase ? `Вброс: ${vbrosPhase}` : null,
    stageTitle,
    `Ведёт: ${lead}`,
    admin ? `Менеджер: ${managerUsername || 'не назначен'}` : null,
    admin ? `Регион: ${regionCode || 'не задан'}` : null,
    `Ждёт: ${time}`,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div
      data-testid="agent-card"
      role="link"
      tabIndex={0}
      onClick={open}
      onKeyDown={onKeyDown}
      title={title}
      className={cn(
        'agentCard',
        ROW_HEIGHT,
        'grid cursor-pointer items-center gap-3 px-3 text-sm outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50',
        admin ? QUEUE_GRID_ADMIN : QUEUE_GRID,
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="relative shrink-0">
          <ClientAvatar
            className="size-6 rounded-full bg-muted text-[10px] font-medium text-muted-foreground"
            style={{ '--av-bg': 'var(--muted)' }}
            src={avatarUrl}
            name={name || '—'}
          />
          {online && (
            <span
              aria-hidden="true"
              data-testid="agent-online"
              className="absolute -right-0.5 -bottom-0.5 size-2 rounded-full border border-card bg-success-foreground"
            />
          )}
        </span>
        <span className="max-w-[60%] shrink-0 truncate font-medium">{who}</span>
        <span className="min-w-0 truncate text-xs text-muted-foreground">{activity || about}</span>
      </div>

      <div className="flex min-w-0 items-center gap-1.5">
        {reason && (
          <Badge variant={urgent ? 'destructive' : 'warning'} className="min-w-0 shrink border-transparent px-0 font-normal">
            <span className="truncate">{reason}</span>
          </Badge>
        )}
        {vbrosPhase ? (
          <span
            className={cn('shrink-0', hot ? 'text-destructive' : 'text-muted-foreground')}
            title={`Вброс: ${vbrosPhase}`}
          >
            <OctagonAlert aria-hidden="true" className="size-3.5" />
          </span>
        ) : null}
      </div>

      <div
        data-testid="agent-stage"
        className="hidden min-w-0 items-center gap-1.5 text-xs text-muted-foreground @min-[480px]:flex"
      >
        {stage?.title ? (
          <>
            <span
              aria-hidden="true"
              className="size-1.5 shrink-0 rounded-full"
              style={{ background: stageColors(stage.index).color }}
            />
            <span className="truncate">{stage.title}</span>
          </>
        ) : (
          '—'
        )}
      </div>

      {admin && (
        <div data-testid="agent-lead" className="hidden min-w-0 items-center gap-1.5 text-xs @min-[620px]:flex">
          <User aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
          <span className={cn('truncate', !managerUsername && 'text-muted-foreground')}>
            {managerUsername || 'не назначен'}
          </span>
        </div>
      )}

      <span className="flex items-center justify-end gap-1 whitespace-nowrap text-xs text-muted-foreground">
        <Clock aria-hidden="true" className="size-3 shrink-0" />
        <span className="tabular-nums">{time}</span>
      </span>
    </div>
  );
}

export default AgentCard;
