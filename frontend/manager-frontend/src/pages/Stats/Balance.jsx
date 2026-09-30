import s from '../../styles/AdminPage.module.scss';
import p from './Stats.module.scss';

/**
 * Остаток на ключе OpenRouter. Отдельным блоком наверху: когда деньги кончатся,
 * бот замолчит во всех чатах разом, и узнать об этом лучше заранее.
 */

const money = (x) => (x === null || x === undefined ? '—' : `$${x.toFixed(2)}`);

/** Цвет полосы слева: сколько дней проживёт остаток при нынешнем расходе. */
const tone = (days) => (days === null || days === undefined ? '' : days < 1.5 ? p.balanceAlarm : days < 4 ? p.balanceWarn : p.balanceCalm);

export default function Balance({ data }) {
  if (!data) return null;

  if (data.error) {
    return (
      <section className={`${p.card} ${p.balance}`}>
        <h3 className={p.cardTitle}>Баланс OpenRouter</h3>
        <p className={s.muted}>{data.error}</p>
      </section>
    );
  }

  return (
    <section className={`${p.card} ${p.balance} ${tone(data.days_left)}`} data-testid="balance-card">
      <div className={p.balanceMain}>
        <span className={p.balanceLabel}>OpenRouter</span>
        <span className={p.balanceValue}>{money(data.left)}</span>
      </div>
      <div className={p.balanceSide}>
        <span><b>{money(data.today)}</b> сегодня</span>
        <span><b>{money(data.week)}</b> за неделю</span>
        <span><b>{money(data.month)}</b> за месяц</span>
      </div>
    </section>
  );
}
