import { useState, useRef, useEffect } from 'react';
import AgentCard from '../AgentCard/AgentCard';
import styles from './NeedManagerAssist.module.scss';
import { matchesQuery, matchesHeadFilters, matchesDateFilter } from '../../utils/search';
import { ChevronDownIcon, ChevronPrevIcon, ChevronNextIcon } from '../../assets/icons';

const SHOW_OPTIONS = [3, 6, 9, 12];

function ShowDropdown({ value, onChange, onClose }) {
  return (
    <div className={styles.showDropdown}>
      {SHOW_OPTIONS.map((opt) => (
        <button
          key={opt}
          className={`${styles.showOption} ${opt === value ? styles.showOptionActive : ''}`}
          onClick={() => {
            onChange(opt);
            onClose();
          }}
        >
          Показать {opt}
        </button>
      ))}
    </div>
  );
}

/** Чаты на ручном режиме показываем, только когда менеджер сам их попросил. */
const MANUAL_KEY = 'nastya_queue_manual_mode';

const readManualFlag = () => {
  try {
    return window.localStorage.getItem(MANUAL_KEY) === '1';
  } catch {
    return false;
  }
};

function NeedManagerAssist({ agents = [], query = '', headFilters = {}, dateFilter = '' }) {
  const [showCount, setShowCount] = useState(6);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [withManual, setWithManual] = useState(readManualFlag);
  const wrapRef = useRef(null);

  const toggleManual = (on) => {
    setWithManual(on);
    setPage(1);
    try {
      window.localStorage.setItem(MANUAL_KEY, on ? '1' : '0');
    } catch {
      // приватное окно: выбор не переживёт перезагрузку, но работать будет
    }
  };

  const filtered = agents.filter(
    (a) =>
      (withManual || a.queue_reason !== 'manual_mode') &&
      matchesQuery(a, query) &&
      matchesHeadFilters(a, headFilters) &&
      matchesDateFilter(a, dateFilter),
  );
  const manualCount = agents.filter((a) => a.queue_reason === 'manual_mode').length;

  const totalPages = Math.max(1, Math.ceil(filtered.length / showCount));
  const visible = filtered.slice((page - 1) * showCount, page * showCount);

  useEffect(() => {
    setPage(1);
  }, [showCount]);

  useEffect(() => {
    if (page > totalPages) setPage(1);
  }, [page, totalPages]);

  useEffect(() => {
    function handleClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <section className={styles.section}>
      <div className={styles.header}>
        <div className={styles.titleRow}>
          <span className={styles.accent}></span>
          <h2 className={styles.title}>Ждут менеджера</h2>
          <span className={styles.badge}>{filtered.length}</span>
          <label className={styles.manualToggle} title="Диалоги, где бота выключили руками, а собеседник ждёт ответа">
            <input
              type="checkbox"
              checked={withManual}
              onChange={(e) => toggleManual(e.target.checked)}
              data-testid="queue-manual-toggle"
            />
            Ручной режим
            {manualCount > 0 && <span className={styles.manualCount}>{manualCount}</span>}
          </label>
        </div>

        <div className={styles.controls}>
          <div className={styles.showWrap} ref={wrapRef}>
            <button
              className={`${styles.showSelect} ${dropdownOpen ? styles.showSelectActive : ''}`}
              onClick={() => setDropdownOpen((v) => !v)}
            >
              <span>Показать {showCount}</span>
              <ChevronDownIcon />
            </button>
            {dropdownOpen && (
              <ShowDropdown
                value={showCount}
                onChange={setShowCount}
                onClose={() => setDropdownOpen(false)}
              />
            )}
          </div>

          <button className={styles.pageBtn} onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
            <ChevronPrevIcon />
          </button>
          <div className={styles.pageInfo}><span className={styles.page}>{page}</span> / <span>{totalPages}</span></div>
          <button className={styles.pageBtn} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
            <ChevronNextIcon />
          </button>
        </div>
      </div>

      <div className={styles.cards}>
        {visible.length ? visible.map((agent) => (
          <AgentCard key={agent.chat_id} agent={agent} showAlert />
        )) : <p className={styles.empty}>Ничего не найдено — сбросьте фильтры и поиск</p>}
      </div>
    </section>
  );
}

export default NeedManagerAssist;
