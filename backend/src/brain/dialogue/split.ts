export const DISPLAY_MESSAGE_LIMIT = 320;
export const TELEGRAM_MESSAGE_LIMIT = 3500;

const WHITESPACE = /\s+/g;
const SENTENCE_END = /[.!?…][)\]"'»]*$/;

export function splitDisplayMessages(
  text: string,
  limit = DISPLAY_MESSAGE_LIMIT,
): string[] {
  if (limit < 1) throw new Error('limit must be positive');
  const parts: string[] = [];
  let start = 0;

  while (text.length - start > limit) {
    const candidates: Array<{ start: number; end: number; value: string }> = [];
    let nextBoundary: number | null = null;

    WHITESPACE.lastIndex = start;
    for (
      let match = WHITESPACE.exec(text);
      match;
      match = WHITESPACE.exec(text)
    ) {
      const found = {
        start: match.index,
        end: match.index + match[0].length,
        value: match[0],
      };
      if (found.start === start) continue;
      if (found.end > start + limit) {
        nextBoundary = found.end;
        break;
      }
      candidates.push(found);
    }

    let end: number;
    if (candidates.length === 0) {
      end = nextBoundary ?? text.length;
    } else {
      const preferred = candidates.filter(
        (item) => item.end - start >= Math.floor(limit / 2),
      );
      const paragraphs = preferred.filter((item) =>
        item.value.includes('\n\n'),
      );
      const sentences = preferred.filter((item) =>
        SENTENCE_END.test(
          text.slice(Math.max(start, item.start - 12), item.start),
        ),
      );
      const lines = preferred.filter((item) => item.value.includes('\n'));
      const chosen = paragraphs.length
        ? paragraphs
        : sentences.length
          ? sentences
          : lines.length
            ? lines
            : candidates;
      end = chosen[chosen.length - 1]!.end;
    }

    if (!text.slice(end).trim()) end = text.length;
    parts.push(text.slice(start, end));
    start = end;
  }

  if (start < text.length) parts.push(text.slice(start));
  return parts;
}

export const MAX_REPLY_BUBBLES = 4;

export function splitReplyMessages(
  reply: string,
  max = MAX_REPLY_BUBBLES,
): string[] {
  const text = reply.replace(/\r\n?/g, '\n').trim();
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return [text];
  while (lines.length > Math.max(1, max)) {
    let at = 0;
    for (let i = 1; i < lines.length - 1; i += 1) {
      if (
        lines[i]!.length + lines[i + 1]!.length <
        lines[at]!.length + lines[at + 1]!.length
      )
        at = i;
    }
    lines.splice(at, 2, `${lines[at]}\n${lines[at + 1]}`);
  }
  return lines;
}

export function splitMessage(
  text: string,
  limit = TELEGRAM_MESSAGE_LIMIT,
): string[] {
  const parts: string[] = [];
  let chunk = '';
  let size = 0;
  for (const char of text) {
    const units = char.length;
    if (size + units > limit) {
      parts.push(chunk);
      chunk = '';
      size = 0;
    }
    chunk += char;
    size += units;
  }
  if (chunk) parts.push(chunk);
  return parts;
}
