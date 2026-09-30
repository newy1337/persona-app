import { useState, useRef, useEffect } from 'react';
import styles from './StatsBar.module.scss';
import { ChevronDownSmIcon } from '../../assets/icons';

const PRESETS = [
  { key: '', label: 'Вся история' },
  { key: 'today', label: 'Сегодня' },
  { key: 'yesterday', label: 'Вчера' },
  { key: '7d', label: '7 дней' },
  { key: '30d', label: '30 дней' },
];

function labelFor(dateFilter) {
  if (!dateFilter) return 'Период: всё время';
  if (String(dateFilter).startsWith('date:')) return dateFilter.slice(5);
  return PRESETS.find((p) => p.key === dateFilter)?.label ?? 'Период';
}

function StatsBar({ stats = [], dateFilter = '', onDateFilterChange }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    function handleClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const pick = (value) => {
    onDateFilterChange?.(value);
    setOpen(false);
  };
  const dateValue = String(dateFilter).startsWith('date:') ? dateFilter.slice(5) : '';

  return (
    <div className={styles.bar}>
      <div className={styles.stats}>
        {stats.map((stat) => (
          <div key={stat.id} className={styles.statItem}>
            <span className={styles.label}>{stat.label}</span>
            <span className={styles.value} style={{ '--stat-color': stat.color }}>{stat.value}</span>
          </div>
        ))}
        <div className={styles.statItem}>
          <div className={styles.dateWrap} ref={wrapRef}>
            <button
              className={`${styles.dateBtn} ${open ? styles.dateBtnActive : ''} ${dateFilter ? styles.dateBtnFiltered : ''}`}
              onClick={() => setOpen((v) => !v)}
              title="Фильтр по дате последнего сообщения"
            >
              <span>{labelFor(dateFilter)}</span>
              <ChevronDownSmIcon />
            </button>
            {open && (
              <div className={styles.dateDropdown}>
                {PRESETS.map((p) => (
                  <button
                    key={p.key || 'all'}
                    className={`${styles.dateOption} ${dateFilter === p.key ? styles.dateOptionActive : ''}`}
                    onClick={() => pick(p.key)}
                  >
                    {p.label}
                  </button>
                ))}
                <label className={styles.dateInputRow}>
                  <span className={styles.dateInputLabel}>Дата</span>
                  <input
                    type="date"
                    className={styles.dateInput}
                    value={dateValue}
                    onChange={(e) => onDateFilterChange?.(e.target.value ? `date:${e.target.value}` : '')}
                  />
                </label>
                {dateFilter && (
                  <button className={styles.dateClear} onClick={() => pick('')}>
                    Сбросить
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default StatsBar;
