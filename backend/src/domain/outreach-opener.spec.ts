import { datingSiteOf, leadSlots } from './outreach-opener';
import { DEFAULT_PROMPTS } from '../brain/nastya/config/prompts';

describe('outreach opener', () => {
  it('the default first line is fixed', () => {
    expect(DEFAULT_PROMPTS.opener).toBe('Привет, это Настя с beboo');
  });

  it('the dating site comes from the persona card', () => {
    expect(datingSiteOf({ dating_site: 'mamba' })).toBe('mamba');
    expect(datingSiteOf({})).toBe('beboo');
  });

  it('lead card → character slots', () => {
    expect(
      leadSlots({ firstName: 'Олег', city: 'Москва', age: 34 }, 'mamba'),
    ).toEqual({
      dating_site: 'mamba',
      name: 'Олег',
      age: '34',
      location: 'Москва',
    });
    expect(leadSlots({})).toEqual({ dating_site: 'beboo' });
  });
});
