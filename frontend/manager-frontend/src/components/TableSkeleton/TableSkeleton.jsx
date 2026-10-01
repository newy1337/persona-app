import styles from './TableSkeleton.module.scss';

/**
 * Заглушка на время загрузки. Держит высоту списка: без неё страница
 * схлопывается до одного экрана, сбрасывает прокрутку и успевает показать
 * «данных нет» раньше, чем данные приходят.
 */
function TableSkeleton({ rows = 6, label = 'Загружаем…' }) {
  return (
    <div className={styles.skeleton} role="status" aria-live="polite" aria-busy="true">
      <span className={styles.label}>{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div className={styles.row} key={i}>
          <span className={`${styles.cell} ${styles.wide}`} />
          <span className={styles.cell} />
          <span className={styles.cell} />
          <span className={`${styles.cell} ${styles.narrow}`} />
        </div>
      ))}
    </div>
  );
}

export default TableSkeleton;
