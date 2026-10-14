import {
  acceptPhotoChoice,
  dropFreshClaims,
  exifDate,
  formatTakenOn,
  hasFalseFreshClaim,
  normalizeTakenOn,
  parseTags,
  photoAvailability,
  photoFreshness,
  photoNote,
  withPhotoNote,
} from './photo-library';

const rules = {
  autoSend: true,
  sendMode: 'initiative',
  minIntervalMin: 60,
  maxPerDay: 2,
  noRepeat: true,
};
const photo = (id: number, extra = {}) => ({
  id,
  description: `фото ${id}`,
  place: null,
  takenOn: null,
  details: '',
  tags: [],
  autoSend: true,
  ...extra,
});
const NOW = 1_800_000_000;

describe('photo library', () => {
  it('keeps only real dates and formats them', () => {
    expect(normalizeTakenOn('2024-02-30')).toBeNull();
    expect(normalizeTakenOn('вчера')).toBeNull();
    expect(normalizeTakenOn('2024-07')).toBe('2024-07');
    expect(formatTakenOn('2024-07-05')).toBe('5 июля 2024');
    expect(formatTakenOn('2024-07')).toBe('июль 2024');
    expect(formatTakenOn(null)).toBe('дата неизвестна');
  });

  it('treats only an exact today date as fresh', () => {
    expect(photoFreshness('2026-10-14', '2026-10-14')).toBe('today');
    expect(photoFreshness('2026-10-10', '2026-10-14')).toBe('recent');
    expect(photoFreshness('2025-10-14', '2026-10-14')).toBe('archive');
    expect(photoFreshness('2026-10', '2026-10-14')).toBe('recent');
    expect(photoFreshness(null, '2026-10-14')).toBe('unknown');
  });

  it('catches "just took it" on an old photo and strips it', () => {
    const text = 'Вот, только что сфоткала своего Барсика';
    expect(hasFalseFreshClaim(text, 'archive')).toBe(true);
    expect(hasFalseFreshClaim(text, 'today')).toBe(false);
    expect(hasFalseFreshClaim('Это мой Барсик, прошлым летом', 'archive')).toBe(
      false,
    );
    const fixed = dropFreshClaims(text);
    expect(hasFalseFreshClaim(fixed, 'archive')).toBe(false);
    expect(fixed).toContain('Барсика');
    expect(dropFreshClaims('Сегодня сфоткал закат')).toBe('сфоткал закат');
  });

  it('puts what was on the photo into the history text', () => {
    const note = photoNote(
      {
        id: 1,
        description: 'рыжий кот на подоконнике',
        place: 'Казань',
        takenOn: '2024-06',
        details: 'кота зовут Барсик',
        tags: ['кот'],
      },
      '2026-10-14',
    );
    expect(note).toContain('Барсик');
    expect(note).toContain('июнь 2024');
    expect(note).toContain('архивный');
    expect(withPhotoNote('Мой красавец', note)).toMatch(
      /^\[Ты отправил\(а\) фото из своей галереи: .*\]\nМой красавец$/,
    );
    expect(withPhotoNote('[фото]', note)).not.toContain('\n');
    expect(withPhotoNote('текст', null)).toBe('текст');
  });

  it('normalizes tags', () => {
    expect(parseTags('["Кот", "#кот", " кафе "]')).toEqual(['кот', 'кафе']);
    expect(parseTags('кот, прогулка')).toEqual(['кот', 'прогулка']);
    expect(parseTags(42)).toEqual([]);
  });

  it('offers only unseen auto-send photos within limits', () => {
    const base = {
      rules,
      accountAutoSend: true,
      photos: [photo(1), photo(2), photo(3, { autoSend: false })],
      now: NOW,
      today: '2026-10-14',
    };
    const fresh = photoAvailability({ ...base, sends: [] });
    expect(fresh.available).toBe(true);
    expect(fresh.candidates.map((c) => c.id)).toEqual(['1', '2']);

    const seen = photoAvailability({
      ...base,
      sends: [{ photoId: 1, sentAt: NOW - 7200, date: '2026-10-13' }],
    });
    expect(seen.candidates.map((c) => c.id)).toEqual(['2']);
    expect(seen.shown_before[0].id).toBe('1');

    const soon = photoAvailability({
      ...base,
      sends: [{ photoId: 1, sentAt: NOW - 600, date: '2026-10-14' }],
    });
    expect(soon.available).toBe(false);

    const capped = photoAvailability({
      ...base,
      rules: { ...rules, minIntervalMin: 0 },
      photos: [photo(1), photo(2), photo(4)],
      sends: [
        { photoId: 1, sentAt: NOW - 600, date: '2026-10-14' },
        { photoId: 2, sentAt: NOW - 300, date: '2026-10-14' },
      ],
    });
    expect(capped.available).toBe(false);
    expect(capped.reason).toMatch(/лимит/);

    expect(
      photoAvailability({ ...base, accountAutoSend: false, sends: [] })
        .available,
    ).toBe(false);
    expect(
      photoAvailability({
        ...base,
        rules: { ...rules, autoSend: false },
        sends: [],
      }).available,
    ).toBe(false);
    expect(
      photoAvailability({
        ...base,
        photos: [photo(1)],
        sends: [{ photoId: 1, sentAt: NOW - 86400 * 3, date: '2026-10-11' }],
      }).available,
    ).toBe(false);
  });

  it('accepts only a listed photo, and in request mode only on request', () => {
    const availability = photoAvailability({
      rules: { ...rules, sendMode: 'request' },
      accountAutoSend: true,
      photos: [photo(1)],
      sends: [],
      now: NOW,
      today: '2026-10-14',
    });
    const choice = { photo_id: '1', reason: 'спросил про кота' };
    expect(acceptPhotoChoice(availability, choice, false)).toBeNull();
    expect(acceptPhotoChoice(availability, choice, true)).toBe('1');
    expect(
      acceptPhotoChoice(availability, { ...choice, photo_id: '9' }, true),
    ).toBeNull();
    expect(
      acceptPhotoChoice(availability, { photo_id: '1', reason: ' ' }, true),
    ).toBeNull();
  });

  it('reads the shooting date from EXIF bytes', () => {
    const exif = Buffer.from('Exif\0\0MM....2023:08:17 14:22:01\0', 'latin1');
    expect(exifDate(exif)).toBe('2023-08-17');
    expect(exifDate(Buffer.from('0000:00:00 00:00:00'))).toBeNull();
    expect(exifDate(undefined)).toBeNull();
  });
});
