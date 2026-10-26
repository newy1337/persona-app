import { useState } from 'react';
import { Bookmark, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { PanelUX } from '../../ui/PanelUX';
import { isActive } from './filters';

// Сохранённые наборы фильтров таблицы: «Мои срочные», «Холодка без этапа».
// Это удобство одного сотрудника, поэтому живут в его браузере (localStorage);
// пропали — таблица просто без них.
const keyOf = (tableId) => `saved_filters_${tableId}`;
const MAX = 20;

export function loadSaved(tableId) {
  try {
    const list = JSON.parse(localStorage.getItem(keyOf(tableId)) || '[]');
    return Array.isArray(list) ? list.filter((x) => x && typeof x.name === 'string' && x.state) : [];
  } catch {
    return [];
  }
}

function store(tableId, list) {
  try {
    localStorage.setItem(keyOf(tableId), JSON.stringify(list));
  } catch {
    // приватный режим — набор проживёт до перезагрузки
  }
}

const same = (a, b) => JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});

export function SavedFilters({ tableId, state, onApply }) {
  const [list, setList] = useState(() => loadSaved(tableId));
  const hasActive = Object.values(state ?? {}).some(isActive);
  const update = (next) => {
    setList(next);
    store(tableId, next);
  };

  async function saveCurrent() {
    const name = await PanelUX.prompt({ title: 'Сохранить фильтры', message: 'Как назвать набор? Например: «Мои срочные».', value: '', confirmLabel: 'Сохранить' });
    if (!name?.trim()) return;
    const rest = list.filter((x) => x.name !== name.trim());
    update([...rest, { name: name.trim(), state }].slice(-MAX));
  }

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="xs" className="shrink-0 gap-1 font-normal text-muted-foreground" data-testid="saved-filters">
          <Bookmark aria-hidden="true" />
          Мои фильтры{list.length > 0 && <span className="tabular-nums">· {list.length}</span>}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {list.length === 0 && <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Сохранённых наборов пока нет. Задайте фильтры в колонках и сохраните их здесь.</DropdownMenuLabel>}
        {list.map((x) => (
          <DropdownMenuItem key={x.name} className="justify-between gap-2" onSelect={() => onApply(x.state)}>
            <span className="truncate">
              {x.name}
              {same(x.state, state) && <span className="ml-1.5 text-xs text-muted-foreground">· сейчас</span>}
            </span>
            <button
              type="button"
              aria-label={`Удалить набор: ${x.name}`}
              className="grid size-5 shrink-0 place-items-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                update(list.filter((y) => y.name !== x.name));
              }}
            >
              <X className="size-3" aria-hidden="true" />
            </button>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!hasActive} onSelect={saveCurrent}>
          Сохранить текущие фильтры…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
