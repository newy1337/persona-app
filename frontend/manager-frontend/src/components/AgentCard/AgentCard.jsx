import { Attribution } from '../../ui/ManagerRegion';
import { useNavigate } from 'react-router-dom';
import styles from './AgentCard.module.scss';
import { StatusIcon, LightningIcon, ClockIcon } from '../../assets/icons';
import { priorityColor } from '../../data/stages';

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

  return (
    <div className={styles.card} onClick={() => navigate(`/conversation/${chatId}`)} style={{ cursor: 'pointer' }}>
      <div className={styles.top}>
        <div className={styles.info}>
          <span className={styles.name}>{name || `Чат ${chatId}`}</span>
          <div className={styles.sub}>
            {[age ? `${age} лет` : null, city || null].filter(Boolean).length ? (
              <>
                {age ? <span className={styles.subAge}>{age} лет</span> : null}
                {age && city ? <span className={styles.subDot}>·</span> : null}
                {city ? <span className={styles.subLocation} title={city}>{city}</span> : null}
              </>
            ) : (
              <span className={styles.subAge}>
                {accountId == null ? 'аккаунт удалён' : accountUsername ? `@${accountUsername}` : 'возраст и город неизвестны'}
              </span>
            )}
          </div>
        </div>
        {showAlert && vbrosPhase && (
          <div className={styles.tooltipWrap} title={vbrosPhase ? `Вброс: ${vbrosPhase}` : 'Вброса нет'}>
            <StatusIcon color={priorityColor(vbrosPhase)} />
          </div>
        )}
      </div>

      <Attribution value={agent} compact />
      {showAlert && REASON_LABEL[queueReason] && (
        <span
          className={`${styles.reason} ${String(queueReason).startsWith('media_') ? styles.reasonUrgent : ''}`}
          title={REASON_LABEL[queueReason]}
        >
          {REASON_LABEL[queueReason]}
        </span>
      )}

      <div className={styles.bottom}>
        {isManager ? (
          <div className={`${styles.pill} ${styles.pillManager}`}>
            <span className={styles.pillDot}></span>
            <LightningIcon />
            <span>Менеджер</span>
          </div>
        ) : (
          <div className={`${styles.pill} ${styles.pillAI}`}>
            <span className={styles.pillDot}></span>
            <LightningIcon />
            <span>Бот</span>
          </div>
        )}

        <div className={styles.timer}>
          <ClockIcon />
          <span className={styles.timerValue}>{waitingFor(waitingSince ?? holdArmedAt)}</span>
        </div>
      </div>
    </div>
  );
}

export default AgentCard;
