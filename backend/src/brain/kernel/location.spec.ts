import { cityPlace, residenceSource } from './location';
import { LocationResolver } from './location-resolver';

describe('city gazetteer', () => {
  it.each([
    ['Madrid', 'ES', 'Europe/Madrid'],
    ['Калининград', 'RU', 'Europe/Kaliningrad'],
    ['Пхукет', 'TH', 'Asia/Bangkok'],
    ['Лиссабон', 'PT', 'Europe/Lisbon'],
    ['New York', 'US', 'America/New_York'],
    ['Омск', 'RU', 'Asia/Omsk'],
    ['Томск', 'RU', 'Asia/Tomsk'],
    ['Петропавловск', 'KZ', 'Asia/Almaty'],
    ['Rawai', 'TH', 'Asia/Bangkok'],
  ])('%s maps to its own IANA zone', (city, country, timezone) => {
    expect(cityPlace(city, country).timezone).toBe(timezone);
  });
  it('does not guess for an ambiguous or nonexistent city', () => {
    expect(cityPlace('Springfield').status).toBe('unknown');
    expect(cityPlace('НесуществующийГород123').timezone).toBeNull();
  });
});

describe('residence resolution and invalidation', () => {
  const setup = (extract: jest.Mock) => {
    const entries = new Map();
    const cache = {
      get: async (key: string) => entries.get(key) ?? null,
      set: async (key: string, value: string, updatedAt: number) => {
        entries.set(key, { value, updatedAt });
      },
    };
    return { resolver: new LocationResolver(cache, extract), cache };
  };
  it('resolves the extracted current residence, excluding dialogue examples from the source', async () => {
    const source = residenceSource({
      card: ['Родом из Перми. Живу в Мадриде, Испания.'],
      examples: ['Я в Москве'],
      stories: ['Отдыхал в Таиланде'],
    });
    const extract = jest.fn().mockResolvedValue({
      city: 'Madrid',
      country: 'ES',
      evidence: 'Живу в Мадриде, Испания.',
      uncertain: false,
    });
    const { resolver } = setup(extract);
    expect(source).not.toContain('Москве');
    expect((await resolver.resolve('persona', source)).timezone).toBe(
      'Europe/Madrid',
    );
  });
  it('reuses the persistent result but re-resolves changed biography and changed user city', async () => {
    const extract = jest
      .fn()
      .mockResolvedValueOnce({
        city: 'Madrid',
        country: 'ES',
        evidence: 'Живу в Мадриде',
        uncertain: false,
      })
      .mockResolvedValueOnce({
        city: 'Lisbon',
        country: 'PT',
        evidence: 'Теперь живу в Лиссабоне',
        uncertain: false,
      });
    const { resolver, cache } = setup(extract);
    const first = residenceSource({ card: ['Живу в Мадриде'] });
    await resolver.resolve('persona', first);
    await new LocationResolver(cache, extract).resolve('persona', first);
    expect(extract).toHaveBeenCalledTimes(1);
    expect(
      (
        await resolver.resolve(
          'persona',
          residenceSource({ card: ['Теперь живу в Лиссабоне'] }),
        )
      ).timezone,
    ).toBe('Europe/Lisbon');
    expect(
      (await resolver.resolve('interlocutor', 'Калининград')).timezone,
    ).toBe('Europe/Kaliningrad');
    expect((await resolver.resolve('interlocutor', 'Томск')).timezone).toBe(
      'Asia/Tomsk',
    );
  });
  it('does not accept an invented source quote or uncertain residence', async () => {
    const extract = jest.fn().mockResolvedValue({
      city: 'Madrid',
      country: 'ES',
      evidence: 'Живу в Мадриде',
      uncertain: false,
    });
    const { resolver } = setup(extract);
    expect(
      (
        await resolver.resolve(
          'persona',
          residenceSource({ card: ['Место не указано'] }),
        )
      ).timezone,
    ).toBeNull();
    extract.mockResolvedValue({
      city: 'Madrid',
      country: 'ES',
      evidence: 'Два дома',
      uncertain: true,
    });
    expect((await resolver.resolve('persona', 'Два дома')).timezone).toBeNull();
  });
  it('handles resolver failure without inventing a timezone', async () => {
    const { resolver } = setup(
      jest.fn().mockRejectedValue(new Error('network')),
    );
    expect(
      (await resolver.resolve('persona', 'Живу где-то')).timezone,
    ).toBeNull();
  });
  it('deduplicates simultaneous requests for the same new biography', async () => {
    const extract = jest.fn().mockResolvedValue({
      city: 'Madrid',
      country: 'ES',
      evidence: 'Мадрид',
      uncertain: false,
    });
    const { resolver } = setup(extract);
    const results = await Promise.all([
      resolver.resolve('persona', 'Мадрид'),
      resolver.resolve('persona', 'Мадрид'),
    ]);
    expect(results.map((x) => x.timezone)).toEqual([
      'Europe/Madrid',
      'Europe/Madrid',
    ]);
    expect(extract).toHaveBeenCalledTimes(1);
  });
});
