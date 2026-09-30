import { moscowDay } from '../../utils/panelTime';

export function dayStamp(now = new Date()) { return moscowDay(now); }

export function slugPart(slug) {
  return String(slug || '').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'persona';
}

export function saveJsonFile(name, doc) {
  const blob = new Blob([`${JSON.stringify(doc, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
