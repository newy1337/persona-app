import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { PanelUX } from '../../ui/PanelUX';
import s from '../../styles/AdminPage.module.scss';
import v from './VoiceWork.module.scss';

function Notes({ title, items }) {
  return items?.length ? <section><strong>{title}</strong><ul>{items.map((item, i) => <li key={i}>{item.text || item}{item.date && <small> · {item.date}</small>}</li>)}</ul></section> : null;
}
export function CallBrief({ task }) {
  const [brief, setBrief] = useState(null), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true, pending = false;
    setBrief(null); setError('');
    async function load() {
      if (pending || document.visibilityState === 'hidden') return;
      pending = true;
      try { const result = await api.get(`/api/voicer/tasks/${task.id}/brief`); if (active) { setBrief(result); setError(''); } }
      catch (e) { if (active) { setBrief(null); setError(PanelUX.readableError(e)); } }
      finally { pending = false; }
    }
    load(); const timer = setInterval(load, 15000);
    document.addEventListener('visibilitychange', load);
    return () => { active = false; clearInterval(timer); document.removeEventListener('visibilitychange', load); };
  }, [task.id, task.chatId, retry]);
  return <details className={v.callBrief} open>
    <summary>Памятка к звонку</summary>
    {error ? <p role="alert" className={s.error}>{error} <button className={s.btnSm} onClick={() => setRetry(n => n + 1)}>Повторить</button></p>
      : !brief?.persona ? <p role="status">Загружаем памятку…</p> : <>
        <p className={s.hint}>Данные из карточки и сохранённой памяти. Если факт не указан — он неизвестен. Последние сообщения могут содержать уточнения.</p>
        <div className={v.briefColumns}>
          <section><h4>Личность · {brief.persona.name}</h4>
            {brief.persona.sections.map((section, i) => i === 0 ? <Notes key={section.title} title={section.title} items={section.items} />
              : <details key={section.title}><summary>{section.title}</summary><Notes items={section.items} /></details>)}
            {!brief.persona.sections.length && <p>Краткой карточки нет. Полная биография доступна в задании.</p>}
          </section>
          <section><h4>Собеседник · {brief.interlocutor.label}</h4>
            {!brief.interlocutor.linked ? <p>Привяжите диалог, чтобы получить сведения о собеседнике.</p> : <>
              <dl>{brief.interlocutor.fields.map((f, i) => <div key={i}><dt>{f.label}</dt><dd>{f.value}</dd></div>)}</dl>
              {!brief.interlocutor.fields.length && <p>Основные сведения пока не сохранены.</p>}
              <Notes title="Что любит и что важно" items={brief.interlocutor.preferences} />
              <Notes title="Важные факты" items={brief.interlocutor.facts} />
              <Notes title="Что обсуждали" items={brief.interlocutor.context} />
              <Notes title="Договорённости" items={brief.interlocutor.agreements} />
            </>}
          </section>
        </div>
        {!!brief.recent.length && <details><summary>Последнее в переписке</summary>{brief.recent.map(m => <p key={m.id}><strong>{m.speaker}:</strong> {m.text}</p>)}</details>}
      </>}
  </details>;
}
