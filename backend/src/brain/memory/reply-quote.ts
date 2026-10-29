const QUOTE_LIMIT = 160;

/** Короткая цитата для пометки: одной строкой, длинное обрезано. */
export function quoteSnippet(text: string | null | undefined): string | null {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!flat) return null;
  return flat.length > QUOTE_LIMIT
    ? `${flat.slice(0, QUOTE_LIMIT - 1).trimEnd()}…`
    : flat;
}

/**
 * Реплика с пометкой, на что собеседник ответил: в Telegram и VK он может
 * ответить на старое сообщение, и без пометки модель видит только череду
 * сообщений и не понимает, к чему ответ.
 */
export function withReplyQuote(
  text: string,
  quote: string | null | undefined,
): string {
  const snippet = quoteSnippet(quote);
  return snippet ? `[в ответ на: «${snippet}»]\n${text}` : text;
}
