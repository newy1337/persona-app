import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { DEAL_STAGES, DEAL_STAGE_COLORS } from '../../data/dealStages';
import { genderLabel } from '../../utils/chat';
import { NEXT_TONE, leadProblems, leadTypeLabel, nextStepState, nextStepWhen, shortDate } from './leadInfo';

// Воронка лидов: колонка на каждый этап сделки и «Без этапа» первой. Карточку
// перетаскивают в другой этап — меняется этап диалога лида (как селект
// «Этап» в диалогах). Без диалога этапа нет: такие лиды лежат в «Без этапа» и
// не перетаскиваются. Убрать этап нельзя, поэтому в «Без этапа» не бросают.
// Щелчок по карточке открывает карточку лида. В колонке рисуются первые
// PER_COLUMN лидов, остальные — по кнопке «Показать ещё».
const PER_COLUMN = 50;
const COLUMNS = [{ id: 'none', label: 'Без этапа' }, ...DEAL_STAGES];

function LeadTile({ lead, idlePersonas, onOpen, onDragStart }) {
  const name = lead.first_name || lead.phone_e164 || (lead.username ? `@${lead.username}` : `Лид #${lead.id}`);
  const about = [lead.age ? `${lead.age} лет` : null, genderLabel(lead.gender, true), lead.city].filter(Boolean).join(' · ');
  const next = nextStepState(lead);
  const movable = Boolean(lead.telegram_user_id);
  const problems = leadProblems(lead, idlePersonas);
  return (
    <button
      type="button"
      draggable={movable}
      data-lead-id={lead.id}
      data-problem={problems.length ? 'true' : undefined}
      title={[problems.join('; '), movable ? 'Перетащите в другой этап' : 'Этап появится, когда будет диалог'].filter(Boolean).join('\n')}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', String(lead.id));
        e.dataTransfer.effectAllowed = 'move';
        onDragStart(lead);
      }}
      onClick={() => onOpen(lead)}
      className={cn(
        'flex w-full flex-col gap-1 rounded-lg border bg-card p-2.5 text-left text-sm shadow-xs outline-none hover:border-ring/60 focus-visible:ring-[3px] focus-visible:ring-ring/50',
        movable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
        problems.length > 0 && 'border-destructive/60 bg-destructive/10',
      )}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="truncate font-medium">{name}</span>
        {lead.unread_count > 0 && <Badge className="ml-auto h-5 px-1.5 tabular-nums">{lead.unread_count}</Badge>}
      </span>
      {about && <span className="truncate text-xs text-muted-foreground">{about}</span>}
      <span className="flex min-w-0 items-center gap-1.5 text-xs">
        <Badge variant={lead.cold ? 'secondary' : 'outline'} className="h-[18px] px-1.5">{leadTypeLabel(lead)}</Badge>
        {lead.manager_username && <span className="truncate text-muted-foreground">{lead.manager_username}</span>}
        {lead.last_message_ts && <span className="ml-auto shrink-0 text-muted-foreground tabular-nums">{shortDate(lead.last_message_ts)}</span>}
      </span>
      {problems.length > 0 && problems[0] !== 'Просрочен следующий шаг' && (
        <span className="truncate text-xs font-medium text-destructive" data-testid="tile-problem">{problems[0]}</span>
      )}
      {next !== 'none' && (
        <span className={cn('truncate text-xs', NEXT_TONE[next], next === 'overdue' && 'font-medium')} data-testid="tile-next" data-state={next}>
          {[lead.next_step, nextStepWhen(lead)].filter(Boolean).join(' · ')}
        </span>
      )}
    </button>
  );
}

export function LeadsBoard({ rows, idlePersonas = [], onOpen, onMove }) {
  const [dragging, setDragging] = useState(null);
  const [over, setOver] = useState(null);
  const [more, setMore] = useState({});
  const byStage = Object.fromEntries(COLUMNS.map((c) => [c.id, []]));
  for (const lead of rows) (byStage[lead.deal_stage] ?? byStage.none).push(lead);

  return (
    <div data-testid="leads-board" className="flex min-h-[420px] gap-3 overflow-x-auto pb-2">
      {COLUMNS.map((col) => {
        const items = byStage[col.id];
        const limit = more[col.id] ?? PER_COLUMN;
        const accepts = dragging && col.id !== 'none' && col.id !== (dragging.deal_stage || 'none');
        return (
          <section
            key={col.id}
            aria-label={`Этап: ${col.label}`}
            data-stage={col.id}
            className={cn(
              'flex w-64 shrink-0 flex-col rounded-lg border bg-muted/30 transition-colors',
              accepts && over === col.id && 'border-primary bg-primary/5',
            )}
            onDragOver={(e) => {
              if (!accepts) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              setOver(col.id);
            }}
            onDragLeave={() => setOver((v) => (v === col.id ? null : v))}
            onDrop={(e) => {
              e.preventDefault();
              const lead = dragging;
              setDragging(null);
              setOver(null);
              if (lead && accepts) onMove(lead, col.id);
            }}
          >
            <header className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
              <span aria-hidden="true" className="size-2 rounded-full" style={{ background: DEAL_STAGE_COLORS[col.id] }} />
              <span className="text-sm font-medium">{col.label}</span>
              <span className="ml-auto text-xs tabular-nums text-muted-foreground">{items.length}</span>
            </header>
            <div className="flex max-h-[calc(100dvh-320px)] min-h-24 flex-col gap-2 overflow-y-auto p-2" onDragEnd={() => { setDragging(null); setOver(null); }}>
              {items.length === 0 && <p className="m-auto py-6 text-xs text-muted-foreground">Пусто</p>}
              {items.slice(0, limit).map((lead) => (
                <LeadTile key={lead.id} lead={lead} idlePersonas={idlePersonas} onOpen={onOpen} onDragStart={setDragging} />
              ))}
              {items.length > limit && (
                <button type="button" className="rounded-md py-1.5 text-xs text-primary hover:bg-muted" onClick={() => setMore((m) => ({ ...m, [col.id]: limit + PER_COLUMN }))}>
                  {`Показать ещё ${Math.min(PER_COLUMN, items.length - limit)}`}
                </button>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
