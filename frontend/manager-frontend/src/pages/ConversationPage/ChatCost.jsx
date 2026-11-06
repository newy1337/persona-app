import { useEffect, useState } from 'react';
import { getChatCost } from '../../api/usage';
import { money } from '../../utils/money';
import { ShortIcon } from '../../assets/icons';
import styles from './ConversationPage.module.scss';

const REFRESH_MS = 60000;

/**
 * Стоимость диалога для админа: расход модели сейчас и к моменту, когда диалогу
 * ставили каждый этап сделки. Этап без времени — не пройден или пройден до
 * того, как время этапов начали записывать.
 */
export default function ChatCost({ chatId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    const pull = () =>
      getChatCost(chatId)
        .then((r) => alive && setData(r))
        .catch((e) => alive && setError(e.detail || e.message));
    pull();
    const timer = setInterval(() => document.visibilityState === 'visible' && pull(), REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [chatId]);

  return (
    <div className={styles.summarySection} data-testid="chat-cost">
      <div className={styles.summaryHeader}>
        <span className={styles.summaryTitle}>
          <span className={styles.summaryIcon}><ShortIcon /></span>
          Стоимость диалога
        </span>
        <span className={styles.summaryTag} title="Расход модели на этот диалог сейчас">
          {data ? money(data.total_usd) : '—'}
        </span>
      </div>
      <div className={styles.cardBody}>
        {error && <span className={styles.checkNote}>Не удалось посчитать: {error}</span>}
        {!error && !data && <span className={styles.checkNote}>Считаю…</span>}
        {data && (
          <>
            <span className={styles.checkRow}>
              <span className={styles.checkMark}>$</span>
              <span className={styles.checkLabel}>Сейчас</span>
              <span className={styles.checkNote}>
                {money(data.total_usd)} · {data.calls.toLocaleString('ru-RU')} вызовов модели
              </span>
            </span>
            {data.stages.map((st) => (
              <span
                key={st.stage}
                className={`${styles.checkRow} ${st.cost_usd == null ? styles.check_skip : styles.check_ok}`}
                title={st.reached_at ? `Этап поставлен ${new Date(st.reached_at * 1000).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })} МСК` : 'Этап не пройден или пройден до записи времени этапов'}
              >
                <span className={styles.checkMark}>{st.cost_usd == null ? '–' : '✓'}</span>
                <span className={styles.checkLabel}>{st.label}</span>
                <span className={styles.checkNote}>
                  {st.cost_usd == null ? 'не дошёл' : `${money(st.cost_usd)}${st.delta_usd != null && st.delta_usd !== st.cost_usd ? ` (+${money(st.delta_usd)})` : ''}`}
                </span>
              </span>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
