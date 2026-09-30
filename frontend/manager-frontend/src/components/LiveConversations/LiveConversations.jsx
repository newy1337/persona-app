import { useState, useRef, useEffect } from 'react';
import AgentCard from '../AgentCard/AgentCard';
import styles from './LiveConversations.module.scss';
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

function LiveConversations({ agents = [], query = '', headFilters = {}, dateFilter = '' }) {
  const [showCount, setShowCount] = useState(6);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [page, setPage] = useState(1);
  const wrapRef = useRef(null);

  const filtered = agents.filter(
    (a) => matchesQuery(a, query) && matchesHeadFilters(a, headFilters) && matchesDateFilter(a, dateFilter),
  );

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
          <h2 className={styles.title}>Активные диалоги</h2>
          <span className={styles.badge}>
            {filtered.length === agents.length ? agents.length : `${filtered.length} из ${agents.length}`}
          </span>
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
          <AgentCard key={agent.chat_id} agent={agent} />
        )) : <p className={styles.empty}>Ничего не найдено — сбросьте фильтры и поиск</p>}
      </div>
    </section>
  );
}

export default LiveConversations;
