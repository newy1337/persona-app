const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

/**
 * Номера страниц с пропусками: 1 … 4 5 6 … 20. Когда страниц больше семи,
 * ячеек всегда ровно семь — ширина переключателя не меняется при листании.
 * Пропуски приходят строками 'gap-start' / 'gap-end'.
 */
export function pageItems(page, pages) {
  if (pages <= 7) return range(1, pages);
  if (page <= 4) return [...range(1, 5), 'gap-end', pages];
  if (page >= pages - 3) return [1, 'gap-start', ...range(pages - 4, pages)];
  return [1, 'gap-start', page - 1, page, page + 1, 'gap-end', pages];
}
