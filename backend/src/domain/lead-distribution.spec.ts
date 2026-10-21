import {
  coldSkipReason,
  pickColdRecipient,
  pickRecipient,
  skipReason,
  type Recipient,
} from './lead-distribution';

const r = (over: Partial<Recipient>): Recipient => ({
  id: 1,
  region: '001',
  online: true,
  quota: null,
  sources: [],
  donors: [],
  personas: [],
  todayCount: 0,
  lastReceivedAt: null,
  ...over,
});
const lead = { source: 'Beboo', donor: 'camp-1', region: null, persona: null };

describe('распределение входящих лидов', () => {
  it('берёт того, кто сегодня получил меньше, при равенстве — кто дольше ждал', () => {
    const list = [
      r({ id: 1, todayCount: 3, lastReceivedAt: 10 }),
      r({ id: 2, todayCount: 1, lastReceivedAt: 50 }),
      r({ id: 3, todayCount: 1, lastReceivedAt: 20 }),
    ];
    expect(pickRecipient(list, lead)?.id).toBe(3);
  });

  it('пропускает оффлайн, исчерпанный лимит, чужой источник и чужого донора', () => {
    const list = [
      r({ id: 1, online: false }),
      r({ id: 2, quota: 2, todayCount: 2 }),
      r({ id: 3, sources: ['vk'] }),
      r({ id: 4, donors: ['other'] }),
      r({ id: 5, sources: ['beboo '], donors: ['CAMP-1'] }),
    ];
    expect(pickRecipient(list, lead)?.id).toBe(5);
  });

  it('пустые списки источников и доноров значат «любые»', () => {
    expect(
      pickRecipient([r({ id: 7 })], {
        source: null,
        donor: null,
        region: null,
        persona: null,
      })?.id,
    ).toBe(7);
    expect(
      pickRecipient([r({ id: 7, sources: ['vk'] })], {
        source: null,
        donor: null,
        region: null,
        persona: null,
      }),
    ).toBeNull();
  });

  it('регион из запроса ограничивает кандидатов, без региона — любой', () => {
    const list = [
      r({ id: 1, region: '001', todayCount: 0 }),
      r({ id: 2, region: '002', todayCount: 5 }),
    ];
    expect(pickRecipient(list, { ...lead, region: '002' })?.id).toBe(2);
    expect(pickRecipient(list, { ...lead, region: '003' })).toBeNull();
    expect(skipReason(list, { ...lead, region: '003' })).toContain('003');
    expect(
      skipReason([r({ region: '002', online: false })], {
        ...lead,
        region: '002',
      }),
    ).toContain('нет менеджеров онлайн');
    expect(pickRecipient(list, lead)?.id).toBe(1);
  });

  it('личность: список менеджера ограничивает, пусто — любые', () => {
    const list = [
      r({ id: 1, personas: ['nastya'], todayCount: 0 }),
      r({ id: 2, todayCount: 3 }),
    ];
    expect(pickRecipient(list, { ...lead, persona: 'nastya' })?.id).toBe(1);
    expect(pickRecipient(list, { ...lead, persona: 'olga' })?.id).toBe(2);
    expect(pickRecipient([list[0]], { ...lead, persona: null })).toBeNull();
    expect(skipReason([list[0]], { ...lead, persona: 'olga' })).toContain(
      'личность',
    );
  });

  it('объясняет, почему никто не подошёл', () => {
    expect(skipReason([r({ online: false })], lead)).toBe(
      'нет менеджеров онлайн',
    );
    expect(skipReason([r({ sources: ['vk'] })], lead)).toContain('источник');
    expect(skipReason([r({ donors: ['x'] })], lead)).toContain('донора');
    expect(skipReason([r({ quota: 1, todayCount: 1 })], lead)).toContain(
      'лимит',
    );
  });
});

describe('холодка', () => {
  it('раздаёт поровну между всеми регионами, только тем, у кого она включена', () => {
    const list = [
      r({ id: 1, region: '001', cold: true, todayCount: 2 }),
      r({
        id: 2,
        region: '777',
        cold: true,
        todayCount: 1,
        lastReceivedAt: 50,
      }),
      r({
        id: 3,
        region: '777',
        cold: true,
        todayCount: 1,
        lastReceivedAt: 20,
      }),
      r({ id: 4, region: '001', cold: false, todayCount: 0 }),
    ];
    expect(pickColdRecipient(list, 'beboo')?.id).toBe(3);
  });

  it('не берёт оффлайн, с выбранным лимитом и чужим источником; доноры и личности не мешают', () => {
    const list = [
      r({ id: 1, cold: true, online: false }),
      r({ id: 2, cold: true, quota: 1, todayCount: 1 }),
      r({ id: 3, cold: true, sources: ['vk'] }),
      r({
        id: 4,
        cold: true,
        donors: ['camp-9'],
        personas: ['denis'],
        todayCount: 5,
      }),
    ];
    expect(pickColdRecipient(list, 'Beboo')?.id).toBe(4);
  });

  it('объясняет, почему никто не подошёл', () => {
    expect(coldSkipReason([r({ cold: false })], 'beboo')).toBe(
      'холодку никто не получает',
    );
    expect(coldSkipReason([r({ cold: true, online: false })], 'beboo')).toBe(
      'из получающих холодку никого нет онлайн',
    );
    expect(coldSkipReason([r({ cold: true, sources: ['vk'] })], 'beboo')).toBe(
      'никто не принимает источник «beboo»',
    );
    expect(coldSkipReason([r({ cold: true, quota: 0 })], 'beboo')).toBe(
      'у подходящих менеджеров исчерпан лимит',
    );
  });
});
