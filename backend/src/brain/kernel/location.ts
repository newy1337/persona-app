import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

export interface Place {
  status: 'resolved' | 'unknown';
  city: string;
  country: string;
  timezone: string | null;
  reason?: string;
}

export const unknownPlace = (
  reason = 'Город не указан или неоднозначен',
): Place => ({
  status: 'unknown',
  city: '',
  country: '',
  timezone: null,
  reason,
});

export function validTimezone(value: unknown): value is string {
  if (typeof value !== 'string' || !value.includes('/')) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const normal = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
const RU_LATIN: Record<string, string> = Object.fromEntries(
  [...'абвгдежзийклмнопрстуфхцчшщъыьэюя'].map((c, i) => [
    c,
    [
      'a',
      'b',
      'v',
      'g',
      'd',
      'e',
      'zh',
      'z',
      'i',
      'y',
      'k',
      'l',
      'm',
      'n',
      'o',
      'p',
      'r',
      's',
      't',
      'u',
      'f',
      'kh',
      'ts',
      'ch',
      'sh',
      'shch',
      '',
      'y',
      '',
      'e',
      'yu',
      'ya',
    ][i],
  ]),
);
const canonical = (s: string) =>
  normal(s).replace(/[а-я]/g, (c) => RU_LATIN[c] ?? c);
type City = [string, string, string, string[], string[]];
let index: Map<string, City[]>;

export function cityPlace(city: string, country = '', region = ''): Place {
  if (!index) {
    index = new Map();
    const cities = JSON.parse(
      gunzipSync(
        readFileSync(join(__dirname, 'city-timezones.json.gz')),
      ).toString('utf8'),
    );
    for (const row of cities as City[]) {
      for (const alias of new Set(row[4].map(normal))) {
        const entries = index.get(alias) ?? [];
        entries.push(row);
        index.set(alias, entries);
      }
    }
  }
  let matches = index.get(normal(city)) ?? [];
  if (country)
    matches = matches.filter((row) => row[1] === country.toUpperCase());
  if (region && new Set(matches.map((row) => row[2])).size > 1) {
    const regionName = (s: string) =>
      normal(s)
        .replace(/\b(province|region|oblast|state|governorate)\b/g, '')
        .trim();
    matches = matches.filter((row) =>
      row[3].some((name) => regionName(name) === regionName(region)),
    );
  }
  const modern = matches.filter(
    (row) =>
      canonical(row[0]).replace(/ city$/, '') ===
      canonical(city).replace(/ city$/, ''),
  );
  if (modern.length) matches = modern;
  const zones = new Set(matches.map((row) => row[2]));
  if (zones.size !== 1)
    return unknownPlace(
      matches.length
        ? 'Нужна страна или регион города'
        : 'Город не найден в справочнике',
    );
  const timezone = [...zones][0];
  if (!validTimezone(timezone))
    return unknownPlace('Часовой пояс не поддерживается');
  const countries = new Set(matches.map((row) => row[1]));
  return {
    status: 'resolved',
    city: matches[0][0],
    country: countries.size === 1 ? matches[0][1] : '',
    timezone,
  };
}

export function residenceSource(persona: Record<string, any>): string {
  const keys = [
    'current_location',
    'current_city',
    'residence',
    'location',
    'city',
    'place',
    'card',
    'bio',
    'biography',
    'identity',
  ];
  const data = Object.fromEntries(
    keys.filter((k) => persona[k] != null).map((k) => [k, persona[k]]),
  );
  if (persona.daily_life?.home) data['home'] = persona.daily_life.home;
  return JSON.stringify(data);
}
