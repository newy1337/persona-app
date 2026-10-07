import { useState } from 'react';
import { Hourglass } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { NativeCheckbox } from '@/components/ui/native-checkbox';
import AgentListPanel from '../AgentCard/AgentListPanel';
import { matchesQuery, matchesHeadFilters } from '../../utils/search';

const MANUAL_KEY = 'nastya_queue_manual_mode';

const readManualFlag = () => {
  try {
    return window.localStorage.getItem(MANUAL_KEY) === '1';
  } catch {
    return false;
  }
};

function NeedManagerAssist({ agents = [], query = '', headFilters = {}, loading = false }) {
  const [withManual, setWithManual] = useState(readManualFlag);

  const toggleManual = (on) => {
    setWithManual(on);
    try {
      window.localStorage.setItem(MANUAL_KEY, on ? '1' : '0');
    } catch {
      // приватное окно: выбор не переживёт перезагрузку, но работать будет
    }
  };

  const shown = agents.filter((a) => withManual || a.queue_reason !== 'manual_mode');
  const filtered = shown.filter((a) => matchesQuery(a, query) && matchesHeadFilters(a, headFilters));
  const manualCount = agents.filter((a) => a.queue_reason === 'manual_mode').length;

  return (
    <AgentListPanel
      title="Ждут менеджера"
      icon={Hourglass}
      count={filtered.length}
      agents={filtered}
      showAlert
      loading={loading}
      emptyText={shown.length ? 'Ничего не найдено — сбросьте фильтры и поиск' : 'Никто не ждёт'}
    >
      {/* Галочка «Ручной режим»: показывать ли диалоги, где бота выключили руками.
          Прямой родитель чекбокса содержит только текст и счётчик — так читают тесты. */}
      <Label
        title="Диалоги, где бота выключили руками, а собеседник ждёт ответа"
        className="h-7 cursor-pointer gap-1.5 px-1 text-xs font-normal whitespace-nowrap text-muted-foreground select-none hover:text-foreground"
      >
        <NativeCheckbox
          checked={withManual}
          onChange={(e) => toggleManual(e.target.checked)}
          data-testid="queue-manual-toggle"
        />
        Ручной режим
        {manualCount > 0 && (
          <Badge variant="outline" className="h-5 min-w-7 tabular-nums">
            {manualCount}
          </Badge>
        )}
      </Label>
    </AgentListPanel>
  );
}

export default NeedManagerAssist;
