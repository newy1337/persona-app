import { useCallback, useEffect, useState } from 'react';
import { useMe } from '../../components/AppLayout/me';
import { PanelUX as ux } from '../../ui/PanelUX';
import TableSkeleton from '../../components/TableSkeleton/TableSkeleton';
import { getRegionOpeners, putRegionOpener } from '../../api/openers';
import OpenerPool, { splitOpeners, variantsWord } from '../Personas/OpenerPool';
import s from '../../styles/AdminPage.module.scss';
import p from '../Personas/Personas.module.scss';

const filled = (text) => splitOpeners(text).filter((v) => v.trim());

/** Пул одной личности для региона: правка, сохранение, возврат к общему пулу. */
export function PersonaOpeners({ item, region, canManage, onSaved, onError }) {
  const [draft, setDraft] = useState(item.text);
  const [busy, setBusy] = useState(false);
  const [showDefault, setShowDefault] = useState(false);
  useEffect(() => setDraft(item.text), [item.text, region]);
  const dirty = draft !== item.text;
  const own = filled(item.text).length > 0;
  const defaults = filled(item.default_text);

  async function save(text) {
    setBusy(true);
    try {
      await putRegionOpener(region, item.slug, text);
      ux.toast?.(filled(text).length ? `${item.name}: пул региона сохранён` : `${item.name}: снова общий пул личности`);
      onSaved();
    } catch (e) {
      onError(ux.readableError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={p.promptBlock} data-testid={`openers-${item.slug}`}>
      <div className={p.promptHead}>
        <span className={p.promptTitle}>
          {item.name}
          {own && <span className={p.promptOwn}>свой пул региона</span>}
        </span>
        {canManage && (
          <div className={s.actions}>
            {own && (
              <button type="button" className={s.btnSm} disabled={busy} onClick={() => save('')}>
                Вернуться к общему пулу
              </button>
            )}
            <button type="button" className={s.btnPrimary} disabled={!dirty || busy} onClick={() => save(draft)}>
              {busy ? 'Сохранение…' : 'Сохранить'}
            </button>
          </div>
        )}
      </div>
      <p className={p.promptHint}>
        {own
          ? 'Лидам менеджеров региона уходит случайный вариант из этого пула.'
          : `Свой пул не задан — уходит общий пул личности (${defaults.length} ${variantsWord(defaults.length)}). `}
        {!own && (
          <button type="button" className={s.btnSmGhost} onClick={() => setShowDefault((v) => !v)}>
            {showDefault ? 'скрыть' : 'показать'}
          </button>
        )}
      </p>
      {!own && showDefault && (
        <ol className={p.openerDefaults}>
          {defaults.map((v, i) => <li key={i}>{v}</li>)}
        </ol>
      )}
      {canManage ? (
        <OpenerPool value={draft} onChange={setDraft} />
      ) : own ? (
        <ol className={p.openerDefaults}>{filled(item.text).map((v, i) => <li key={i}>{v}</li>)}</ol>
      ) : null}
    </section>
  );
}

export default function Openers() {
  const me = useMe();
  const [region, setRegion] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    () => getRegionOpeners(region).then((d) => { setData(d); setError(''); }).catch((e) => setError(ux.readableError(e))).finally(() => setLoading(false)),
    [region],
  );
  useEffect(() => { load(); }, [load]);

  const admin = me?.role === 'admin';
  return (
    <>
      <div className={s.head}>
        <div>
          <h2 className={s.title}>Первые сообщения</h2>
          <span className={s.muted}>{data?.region ? `регион ${data.region}` : loading ? 'загружаем…' : 'регион не задан'}</span>
        </div>
        {admin && data?.regions?.length > 0 && (
          <select className={s.select} aria-label="Регион" value={data.region ?? ''} onChange={(e) => setRegion(e.target.value)} style={{ maxWidth: 200 }}>
            {data.regions.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        )}
      </div>
      <p className={s.hint}>
        Что бот пишет холодному лиду первым. У региона может быть свой пул на каждую личность: каждому лиду уходит случайный вариант.
        Пока свой пул не задан, уходит общий пул личности. <span className={s.mono}>{'{name}'}</span> — имя личности, <span className={s.mono}>{'{site}'}</span> — сайт знакомств лида.
      </p>
      {error && <p className={s.error} role="alert">{error}</p>}
      {loading ? (
        <TableSkeleton rows={3} label="Загружаем…" />
      ) : !data?.region ? (
        <p className={s.empty}>У вас не указан регион — пул задавать не для кого.</p>
      ) : (
        <div className={p.prompts}>
          {data.items.map((item) => (
            <PersonaOpeners key={`${data.region}:${item.slug}`} item={item} region={data.region} canManage={data.can_manage} onSaved={load} onError={setError} />
          ))}
        </div>
      )}
    </>
  );
}
