import { useState, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { NativeCheckbox } from '@/components/ui/native-checkbox';
import AgentCard from '../AgentCard/AgentCard';
import SectionHeader from '../SectionHeader/SectionHeader';
import { matchesQuery, matchesHeadFilters } from '../../utils/search';

const MANUAL_KEY = 'nastya_queue_manual_mode';

const readManualFlag = () => {
  try {
    return window.localStorage.getItem(MANUAL_KEY) === '1';
  } catch {
    return false;
  }
};

function NeedManagerAssist({ agents = [], query = '', headFilters = {} }) {
  const [showCount, setShowCount] = useState(6);
  const [page, setPage] = useState(1);
  const [withManual, setWithManual] = useState(readManualFlag);

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
      matchesHeadFilters(a, headFilters),
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

  return (
    <section>
      <SectionHeader
        title="Ждут менеджера"
        count={filtered.length}
        showCount={showCount}
        onShowCount={setShowCount}
        page={page}
        totalPages={totalPages}
        onPage={setPage}
      >
        {/* Галочка «Ручной режим»: показывать ли диалоги, где бота выключили руками.
            Прямой родитель чекбокса содержит только текст и счётчик — так читают тесты. */}
        <Label
          title="Диалоги, где бота выключили руками, а собеседник ждёт ответа"
          className="h-8 cursor-pointer gap-1.5 px-1 text-xs font-normal text-muted-foreground select-none hover:text-foreground"
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
      </SectionHeader>

      <div className="grid min-h-[156px] gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {visible.length ? (
          visible.map((agent) => <AgentCard key={agent.chat_id} agent={agent} showAlert />)
        ) : (
          <p className="col-span-full py-6 text-center text-sm text-muted-foreground">
            Ничего не найдено — сбросьте фильтры и поиск
          </p>
        )}
      </div>
    </section>
  );
}

export default NeedManagerAssist;
