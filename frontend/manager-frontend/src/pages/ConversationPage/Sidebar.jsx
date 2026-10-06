import { Attribution } from '../../ui/ManagerRegion';
import ChatNote from './ChatNote';
import styles from './ConversationPage.module.scss';
import { AVATAR_BG } from '../../utils/avatar';
import ClientAvatar from '../../components/ClientAvatar/ClientAvatar';
import { presenceLabel, whenLabel } from '../../utils/telegramStatus';
import EditableValue from '../../components/EditableValue/EditableValue';
import {
  groupByDay,
  familyLabel,
  deliveredBy,
  beatComment,
  isMediaEvidence,
  findMessageIndex,
  phoneLabel,
  shortTitle,
} from '../../utils/scenario';
import { mediaUrl } from '../../utils/chat';
import { setChatNote, pinFact, setDealStage, setSlot } from '../../api/conversations';
import {
  AgeIcon,
  LocationIcon,
  PhoneIcon,
  FamilyIcon,
  ShortIcon,
  AccountIcon,
  StatusIcon,
} from '../../assets/icons';
import { DEAL_STAGES } from '../../data/dealStages';

function Sidebar({
  id,
  data,
  name,
  cfg,
  pins,
  dbPhone,
  dbCity,
  signals,
  goals,
  handoff,
  now,
  beats,
  scenarioBeats,
  telemetryRows,
  busy,
  setBusy,
  load,
  scrollToMessage,
  sidebarOpen,
}) {
  return (
    <aside className={`${styles.sidebar} ${sidebarOpen ? styles.sidebarOpen : ''}`}>
      <div className={styles.agentCard}>
        <div className={styles.inner}>
          <div className={styles.agentAvatarWrap}>
            <ClientAvatar className={styles.agentAvatar} style={{ '--av-bg': AVATAR_BG.blue }} src={data.client_avatar} name={name} />
          </div>
          <div className={styles.agentMain}>
            <span className={styles.agentName}>{name}</span>
            <Attribution value={data} compact />
            {data.blocked_by_client_at ? (
              <span className={styles.presenceBlocked} data-testid="client-blocked">заблокировал(а) нас</span>
            ) : data.cleared_by_client_at ? (
              <span className={styles.presenceBlocked} data-testid="client-cleared">почистил(а) диалог · {whenLabel(data.cleared_by_client_at)}</span>
            ) : (
              presenceLabel(data.client_presence) && (
                <span
                  className={presenceLabel(data.client_presence).tone === 'online' ? styles.presenceOnline : styles.presence}
                  data-testid="client-presence"
                >
                  {presenceLabel(data.client_presence).text}
                </span>
              )
            )}
            {cfg.label && (
              <span
                className={styles.agentBadge}
                style={{ '--badge-color': cfg.color, '--badge-bg': cfg.bg }}
              >
                <span className={styles.badgeDot} />
                {cfg.label}
              </span>
            )}
          </div>
          <div className={styles.agentMeta}>
            <span className={styles.metaRow} data-testid="deal-stage">
              <span className={styles.metaIcon}><StatusIcon color="currentColor" />Этап</span>
              <span className={styles.dealStage}>
                <select
                  className={styles.dealSelect}
                  aria-label="Этап сделки"
                  value={pins.deal_stage || ''}
                  disabled={busy}
                  onChange={async (e) => {
                    const stage = e.target.value;
                    if (!stage) return;
                    let note = '';
                    if (stage === 'archive') {
                      note = window.prompt('Почему в архив?', pins.deal_note || '');
                      if (note == null || !note.trim()) return;
                    }
                    setBusy(true);
                    try {
                      await setDealStage(id, stage, note);
                      load();
                    } catch {
                      // всплывашка action-store уже показала причину
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <option value="">— не задан</option>
                  {DEAL_STAGES.map((st) => (
                    <option key={st.id} value={st.id}>{st.label}</option>
                  ))}
                </select>
                {pins.deal_stage === 'archive' && pins.deal_note && (
                  <span className={styles.dealNote} title="Причина архива">{pins.deal_note}</span>
                )}
              </span>
            </span>
            <span className={styles.metaRow}>
              <span className={styles.metaIcon}><AgeIcon />Возраст</span>
              <EditableValue
                value={pins.age ? String(pins.age) : ''}
                onSave={async (v) => { await pinFact(id, 'age', v); load(); }}
              />
            </span>
            <span className={styles.metaRow}>
              <span className={styles.metaIcon}><LocationIcon />Город</span>
              <EditableValue
                value={pins.city || ''}
                display={pins.city || dbCity || '—'}
                onSave={async (v) => { await pinFact(id, 'city', v); load(); }}
              />
            </span>
            <span className={styles.metaRow}>
              <span className={styles.metaIcon}><LocationIcon />Сайт</span>
              <EditableValue
                value={pins.site || ''}
                title="Сайт знакомств лида — подставляется в {site} этого диалога"
                onSave={async (v) => { await pinFact(id, 'site', v); load(); }}
              />
            </span>
            <span className={styles.metaRow}>
              <span className={styles.metaIcon}><PhoneIcon />Контакт</span>
              {phoneLabel(pins, dbPhone) || (data.client_username ? (
                <a href={`https://t.me/${data.client_username}`} target="_blank" rel="noreferrer" title="Номер скрыт в Telegram — ник собеседника">
                  @{data.client_username}
                </a>
              ) : '—')}
            </span>
            <span className={styles.metaRow} data-testid="writing-account">
              <span className={styles.metaIcon}><AccountIcon />Аккаунт</span>
              {data.account ? (
                <span title={`Аккаунт Telegram, с которого ${data.persona_name || data.account.persona_id || 'личность'} ведёт этот чат`}>
                  {data.account.display_name || data.persona_name || data.account.persona_id}
                  {data.account.username ? (
                    <> · <a href={`https://t.me/${data.account.username}`} target="_blank" rel="noreferrer">@{data.account.username}</a></>
                  ) : data.account.phone ? ` · ${data.account.phone}` : ''}
                </span>
              ) : '—'}
            </span>
            <span className={styles.metaRow}>
              <span className={styles.metaIcon}><FamilyIcon />Семья</span>
              <EditableValue
                value={pins.family || ''}
                display={familyLabel(pins) || '—'}
                onSave={async (v) => { await pinFact(id, 'family', v); load(); }}
              />
            </span>
          </div>
        </div>
        {signals.length > 0 && (
          <div className={styles.signals}>
            {signals.map((s) => (
              <span
                key={s.key}
                className={`${styles.signal} ${s.tone === 'warn' ? styles.signalWarn : styles.signalGood}`}
              >
                {s.text}
              </span>
            ))}
          </div>
        )}
      </div>

      <ChatNote
        note={data.note}
        noteBy={data.note_by}
        noteAt={data.note_at}
        onSave={async (text) => { await setChatNote(id, text); load(); }}
      />

      <div className={styles.summarySection}>
        <div className={styles.summaryHeader}>
          <span className={styles.summaryTitle}>
            <span className={styles.summaryIcon}><ShortIcon /></span>
            Цели знакомства{goals?.stage?.title ? ` · ${goals.stage.title}` : ''}
          </span>
          <span className={styles.summaryTag}>
            {goals ? `${goals.known} / ${goals.total}` : '—'}
          </span>
        </div>
        <div className={styles.cardBody}>
          <div className={`${styles.nextBeat} ${styles['next_' + now.tone]}`}>
            <span className={styles.nextLabel}>сейчас</span>
            <p className={styles.nextText}>{now.text}</p>
            {now.hint && <span className={styles.nextHint}>{now.hint}</span>}
          </div>
          {handoff.map((h) => (
            <span key={h.key} className={`${styles.checkRow} ${styles['check_' + h.state]}`} title={h.title}>
              <span className={styles.checkMark}>
                {h.state === 'ok' ? '✓' : h.state === 'fail' ? '!' : h.state === 'skip' ? '–' : '?'}
              </span>
              <span className={styles.checkLabel}>{h.label}</span>
              <span className={styles.checkNote}>
                <EditableValue
                  value={h.value || ''}
                  display={h.note}
                  title={`${h.title} — нажмите, чтобы отметить вручную`}
                  onSave={async (v) => { await setSlot(id, h.key, v); load(); }}
                />
              </span>
            </span>
          ))}
        </div>
      </div>

      {beats && (
        <div className={styles.summarySection}>
          <div className={styles.summaryHeader}>
            <span className={styles.summaryTitle}>
              <span className={styles.summaryIcon}><ShortIcon /></span>Сценарий
            </span>
            <span className={styles.summaryTag}>
              {beats.delivered} / {beats.total}
            </span>
          </div>

          <div className={styles.cardBody}>
            {groupByDay(scenarioBeats).map((g) => {
              const done = g.items.filter((b) => b.status === 'delivered').length;
              return (
                <div key={g.day} className={styles.dayGroup}>
                  <div className={styles.dayProgressRow}>
                    <span className={`${styles.dayLabel} ${styles.dayProgressLabel}`}>
                      {g.day ? `день ${g.day}` : 'без дня'}
                    </span>
                    <span className={styles.dayTrack}>
                      <span
                        className={styles.progressFill}
                        style={{ width: `${g.items.length ? (done / g.items.length) * 100 : 0}%` }}
                      />
                    </span>
                    <span className={styles.dayFraction}>
                      {done} / {g.items.length}
                    </span>
                  </div>
                  <div className={styles.beatRows}>
                    {g.items.map((b) => {
                      const isDone = b.status === 'delivered';
                      const jumpTo = findMessageIndex(data?.messages, b);
                      const jumpable = jumpTo !== -1;
                      const comment = beatComment(b);
                      return (
                        <div key={b.id}>
                          <div
                            className={`${styles.beatRow} ${jumpable ? styles.beatJumpable : ''}`}
                            title={jumpable ? 'Показать в переписке' : undefined}
                            onClick={jumpable ? () => scrollToMessage(jumpTo) : undefined}
                          >
                            <span className={styles.beatCheck}>{isDone ? '✓' : ''}</span>
                            <span className={`${styles.beatId} ${isDone ? styles.beatIdDone : ''}`}>{b.id}</span>
                            <span className={`${styles.beatTitle} ${isDone ? styles.beatTitleDone : ''}`}>
                              {shortTitle(b.title)}
                            </span>
                          </div>
                          {b.evidence && isMediaEvidence(b.evidence) && (
                            <p className={styles.beatEvidence}>
                              <img
                                className={styles.beatEvidenceThumb}
                                src={mediaUrl(id, b.ts)}
                                alt="Отправленный кадр"
                                onError={(e) => {
                                  e.currentTarget.style.display = 'none';
                                }}
                              />
                              {deliveredBy(b)}: кадр отправлен
                            </p>
                          )}
                          {b.evidence && !isMediaEvidence(b.evidence) && comment && (
                            <p className={styles.beatEvidence}>
                              {comment.kind === 'reason' ? (
                                <>
                                  {deliveredBy(b)}: {comment.text}
                                  {comment.evidence && (
                                    <>
                                      <br />
                                      <span className={styles.beatEvidenceMeta}>
                                        улика: «{comment.evidence}»
                                      </span>
                                    </>
                                  )}
                                </>
                              ) : comment.kind === 'pair' ? (
                                <>
                                  {deliveredBy(b)}: зачтено по обмену
                                  <br />
                                  <span className={styles.beatEvidenceMeta}>клиент:</span>{' '}
                                  «{comment.client || '—'}»{' '}
                                  <span className={styles.beatEvidenceMeta}>Ира:</span> «
                                  {comment.ira || '—'}»
                                </>
                              ) : comment.kind === 'pin' ? (
                                <>
                                  {deliveredBy(b)}:{' '}
                                  {comment.phrase || (
                                    <span className={styles.beatEvidenceMeta}>
                                      ключ леджера
                                    </span>
                                  )}
                                  {comment.key && (
                                    <>
                                      <br />
                                      <span className={styles.beatEvidenceMeta}>
                                        {comment.key}
                                        {comment.value ? `: ${comment.value}` : ''}
                                      </span>
                                    </>
                                  )}
                                </>
                              ) : (
                                <>{deliveredBy(b)}: «{comment.text}»</>
                              )}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {telemetryRows.length > 0 && (
              <div className={styles.telemetryGroup}>
                <span className={styles.dayLabel}>вне счёта</span>
                {telemetryRows.map(({ beat: b, note }) => (
                  <div key={b.id} className={styles.telemetryRow}>
                    <span className={styles.telemetryId}>{b.id}</span>
                    <span className={styles.telemetryTitle}>{shortTitle(b.title)}</span>
                    <span className={styles.telemetryNote}>{note}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </aside>
  );
}

export default Sidebar;
