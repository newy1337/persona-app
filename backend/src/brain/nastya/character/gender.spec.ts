import { personaGender } from './gender';
import { greetingNote } from './snapshot';
import { farewellNote } from '../dialogue/farewell';
import { checkInGuidance, CHECK_IN_GUIDANCE } from '../dialogue/initiative';
import { lateReplyNote } from '../dialogue/rhythm';
import { MEDIA_REQUEST_RULE } from '../judge/plan';

const DENIS = {
  identity: {
    public_label:
      '{name}, мужской персонаж, 39 лет, родом из Перми, живёт в Мадриде',
    ordinary_conversation:
      'обращается к собеседнице в женском роде, о себе говорит в мужском',
  },
  card: ['Денис, мужчина, родился 15 июля 1987 года'],
};
const NASTYA = {
  identity: { public_label: '{name}, 27 лет, почти два года живёт на Пхукете' },
  card: ['27 лет, родилась и выросла в {city}'],
};

describe('род личности в инструкциях из кода', () => {
  it('Денис — мужской, хотя в описании есть «в женском роде» про собеседницу; Настя — женский', () => {
    expect(personaGender(DENIS)).toBe('male');
    expect(personaGender(NASTYA)).toBe('female');
    expect(personaGender({ gender: 'male' })).toBe('male');
    expect(
      personaGender({ gender: 'ж', identity: { public_label: 'мужской' } }),
    ).toBe('female');
    expect(personaGender(undefined)).toBe('female');
  });

  it('мужская личность: о себе в мужском роде, о собеседнице — в женском', () => {
    const male = [
      greetingNote('male'),
      farewellNote({ goodnight: true, morning: true }, 'male'),
      checkInGuidance('male'),
      lateReplyNote(7200, 'male'),
    ].join('\n');
    for (const bad of [
      'Ты уже поздоровалась',
      'пожелала',
      'Напиши сама',
      'не ответила',
      'извинись, что пропала',
      'рада,',
      'Он давно',
      'пожелал ему',
    ]) {
      expect(male).not.toContain(bad);
    }
    expect(male).toContain('Ты уже поздоровался');
    expect(male).toContain('пожелал ей спокойной ночи');
    expect(male).toContain('Она давно не отвечает. Напиши сам');
    expect(male).toContain('куда пропала');
    expect(male).toContain('извинись, что пропал,');
    expect(male).toContain('Её последние сообщения');
    expect(male).toContain('как у неё дела');
  });

  it('женская личность — как было', () => {
    expect(CHECK_IN_GUIDANCE).toBe(checkInGuidance('female'));
    expect(checkInGuidance()).toContain('Он давно не отвечает. Напиши сама');
    expect(greetingNote()).toContain('Ты уже поздоровалась');
    expect(lateReplyNote(7200)).toContain(
      'Его последние сообщения пришли 2 ч назад, и ты тогда не ответила',
    );
  });

  it('судья про фото и голосовые — без имени Насти', () => {
    expect(MEDIA_REQUEST_RULE).not.toMatch(/Наст/);
  });
});
