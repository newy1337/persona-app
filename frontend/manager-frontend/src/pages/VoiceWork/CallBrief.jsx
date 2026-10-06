import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { PanelUX } from '../../ui/PanelUX';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

const muted = 'text-xs text-muted-foreground';

function Notes({ title, items }) {
  return items?.length ? <section className="min-w-0">{title && <strong className="text-sm font-medium">{title}</strong>}<ul className="my-2 list-disc pl-5">{items.map((item, i) => <li key={i} className="my-1.5 text-sm leading-relaxed [overflow-wrap:anywhere]">{item.text || item}{item.date && <small className={muted}> · {item.date}</small>}</li>)}</ul></section> : null;
}
export function CallBrief({ task }) {
  const [brief, setBrief] = useState(null), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true, pending = false;
    setError('');
    async function load() {
      if (pending || document.visibilityState === 'hidden') return;
      pending = true;
      try { const result = await api.get(`/api/voicer/tasks/${task.id}/brief`); if (active) { setBrief(result); setError(''); } }
      catch (e) { if (active) { if ([401, 403, 404].includes(e.status)) setBrief(null); setError(PanelUX.readableError(e)); } }
      finally { pending = false; }
    }
    load(); const timer = setInterval(load, 15000);
    document.addEventListener('visibilitychange', load);
    return () => { active = false; clearInterval(timer); document.removeEventListener('visibilitychange', load); };
  }, [task.id, task.chatId, retry]);
  return <details className="min-w-0 rounded-lg border bg-card px-4 py-3 text-sm text-card-foreground" open>
    <summary className="cursor-pointer font-medium">Памятка к звонку</summary>
    <div className="mt-2 flex min-h-[200px] flex-col gap-2">
      {error && <p role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">{error} <Button type="button" variant="outline" size="sm" onClick={() => setRetry(n => n + 1)}>Повторить</Button></p>}
      {!brief?.persona ? (!error && <div role="status" className="grid min-h-[160px] gap-5 sm:grid-cols-2" aria-label="Загружаем памятку…">
        <span className="sr-only">Загружаем памятку…</span>
        <div className="flex flex-col gap-2"><Skeleton className="h-5 w-2/3" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-5/6" /><Skeleton className="h-4 w-3/4" /></div>
        <div className="flex flex-col gap-2"><Skeleton className="h-5 w-2/3" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-5/6" /><Skeleton className="h-4 w-3/4" /></div>
      </div>) : <>
        <p className={muted}>Данные из карточки и сохранённой памяти. Если факт не указан — он неизвестен. Последние сообщения могут содержать уточнения.</p>
        <div className="grid max-h-[38vh] min-h-[160px] gap-5 overflow-y-auto [overscroll-behavior:contain] [scrollbar-gutter:stable] sm:grid-cols-2">
          <section className="min-w-0"><h4 className="my-3 text-sm font-medium">Личность · {brief.persona.name}</h4>
            {brief.persona.sections.map((section, i) => i === 0 ? <Notes key={section.title} title={section.title} items={section.items} />
              : <details key={section.title} className="my-2"><summary className="cursor-pointer text-sm">{section.title}</summary><Notes items={section.items} /></details>)}
            {!brief.persona.sections.length && <p>Краткой карточки нет. Полная биография доступна в задании.</p>}
          </section>
          <section className="min-w-0"><h4 className="my-3 text-sm font-medium">Собеседник · {brief.interlocutor.label}</h4>
            {!brief.interlocutor.linked ? <p>Привяжите диалог, чтобы получить сведения о собеседнике.</p> : <>
              <dl className="m-0">{brief.interlocutor.fields.map((f, i) => <div key={i} className="my-2"><dt className={muted}>{f.label}</dt><dd className="mt-0.5 whitespace-pre-wrap [overflow-wrap:anywhere]">{f.value}</dd></div>)}</dl>
              {!brief.interlocutor.fields.length && <p>Основные сведения пока не сохранены.</p>}
              <Notes title="Что любит и что важно" items={brief.interlocutor.preferences} />
              <Notes title="Важные факты" items={brief.interlocutor.facts} />
              <Notes title="Что обсуждали" items={brief.interlocutor.context} />
              <Notes title="Договорённости" items={brief.interlocutor.agreements} />
            </>}
          </section>
        </div>
        {!!brief.recent.length && <details className="my-2"><summary className="cursor-pointer text-sm">Последнее в переписке</summary>{brief.recent.map(m => <p key={m.id} className="my-1 whitespace-pre-wrap [overflow-wrap:anywhere]"><strong>{m.speaker}:</strong> {m.text}</p>)}</details>}
      </>}
    </div>
  </details>;
}
