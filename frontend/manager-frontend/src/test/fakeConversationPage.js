// Поддельный сервер страницы диалогов для тестов таблицы: тот же контракт,
// что у GET /api/manager/conversations/page (отбор по этапу сделки и каналу,
// страницы и счётчики по всему набору).
const DEALS = ['vbros', 'predloga', 'soglas', 'lead', 'deposit', 'archive'];
const channelKey = (c) => (c === 'vk' ? 'vk' : 'tg');

export function fakeConversationPage(rows) {
  return async (params = {}) => {
    const size = Number(params.size) || 50;
    let list = rows.filter((r) =>
      (!params.deal || (params.deal === 'none' ? !r.deal_stage : r.deal_stage === params.deal)) &&
      (!params.channel || channelKey(r.channel) === params.channel) &&
      (!params.stage || r.stage?.id === params.stage) &&
      (!params.q || String(r.name ?? '').toLowerCase().includes(String(params.q).toLowerCase())));
    list = [...list].sort((a, b) => (b.last_message_ts ?? 0) - (a.last_message_ts ?? 0));
    const pages = Math.max(1, Math.ceil(list.length / size));
    const page = Math.min(Math.max(1, Number(params.page) || 1), pages);
    const deal = Object.fromEntries([...DEALS, 'none'].map((d) => [d, 0]));
    const stages = new Map();
    for (const r of rows) {
      deal[r.deal_stage ?? 'none'] += 1;
      if (r.stage?.id) stages.set(r.stage.id, { ...r.stage, count: (stages.get(r.stage.id)?.count ?? 0) + 1 });
    }
    return {
      items: list.slice((page - 1) * size, page * size),
      order: list.map((r) => r.chat_id),
      total: list.length,
      all: rows.length,
      page,
      pages,
      size,
      facets: {
        channel: { all: rows.length, tg: rows.filter((r) => channelKey(r.channel) === 'tg').length, vk: rows.filter((r) => channelKey(r.channel) === 'vk').length },
        deal,
        stages: [...stages.values()].sort((a, b) => a.index - b.index),
        new: rows.filter((r) => r.is_paused && r.unread_count > 0).length,
        accounts: [...new Set(rows.map((r) => r.account_id).filter((a) => a != null))],
        no_deal: { count: deal.none, signature: deal.none ? `sig${deal.none}` : '' },
      },
    };
  };
}
