import { MessagesSquare } from 'lucide-react';
import AgentListPanel from '../AgentCard/AgentListPanel';
import { matchesQuery, matchesHeadFilters } from '../../utils/search';

function LiveConversations({ agents = [], query = '', headFilters = {}, loading = false }) {
  const filtered = agents.filter((a) => matchesQuery(a, query) && matchesHeadFilters(a, headFilters));

  return (
    <AgentListPanel
      title="Активные диалоги"
      icon={MessagesSquare}
      count={filtered.length === agents.length ? agents.length : `${filtered.length} из ${agents.length}`}
      agents={filtered}
      loading={loading}
      emptyText={agents.length ? 'Ничего не найдено — сбросьте фильтры и поиск' : 'Сейчас никто не пишет'}
    />
  );
}

export default LiveConversations;
