import { useState, useEffect } from 'react';
import AgentCard from '../AgentCard/AgentCard';
import SectionHeader from '../SectionHeader/SectionHeader';
import { matchesQuery, matchesHeadFilters, matchesDateFilter } from '../../utils/search';

function LiveConversations({ agents = [], query = '', headFilters = {}, dateFilter = '' }) {
  const [showCount, setShowCount] = useState(6);
  const [page, setPage] = useState(1);

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

  return (
    <section className="pt-7">
      <SectionHeader
        title="Активные диалоги"
        count={filtered.length === agents.length ? agents.length : `${filtered.length} из ${agents.length}`}
        showCount={showCount}
        onShowCount={setShowCount}
        page={page}
        totalPages={totalPages}
        onPage={setPage}
      />

      <div className="grid min-h-[156px] gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {visible.length ? (
          visible.map((agent) => <AgentCard key={agent.chat_id} agent={agent} />)
        ) : (
          <p className="col-span-full py-6 text-center text-sm text-muted-foreground">
            Ничего не найдено — сбросьте фильтры и поиск
          </p>
        )}
      </div>
    </section>
  );
}

export default LiveConversations;
