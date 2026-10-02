import { PersonaService } from './persona.service';

describe('место личности для её собственных часов', () => {
  const service = (resolved: any) => {
    const asked: string[] = [];
    const svc: any = Object.create(PersonaService.prototype);
    svc.locations = {
      resolve: async (_kind: string, source: string) => {
        asked.push(source);
        if (resolved instanceof Error) throw resolved;
        return resolved;
      },
    };
    return { svc, asked };
  };

  const persona = (
    timezone: string,
    personaSource = '{"bio":"живу в Пхукете"}',
  ) => ({ rhythm: { timezone }, personaSource }) as any;

  it('город подставляется, когда он того же пояса, что и настроенный', async () => {
    const { svc, asked } = service({
      status: 'resolved',
      city: 'Phuket',
      country: 'TH',
      timezone: 'Asia/Bangkok',
    });
    await expect(svc.personaPlace(persona('Asia/Bangkok'))).resolves.toEqual({
      status: 'resolved',
      city: 'Phuket',
      country: 'TH',
      timezone: 'Asia/Bangkok',
    });
    expect(asked).toEqual(['{"bio":"живу в Пхукете"}']);
  });

  it('город другого пояса не подставляем — часы задал оператор', async () => {
    const { svc } = service({
      status: 'resolved',
      city: 'Phuket',
      country: 'TH',
      timezone: 'Asia/Bangkok',
    });
    await expect(svc.personaPlace(persona('Europe/Moscow'))).resolves.toEqual({
      status: 'resolved',
      city: '',
      country: '',
      timezone: 'Europe/Moscow',
    });
  });

  it('место не определилось — остаётся один часовой пояс', async () => {
    const { svc } = service({
      status: 'unknown',
      city: '',
      country: '',
      timezone: null,
    });
    await expect(svc.personaPlace(persona('Asia/Tbilisi'))).resolves.toEqual({
      status: 'resolved',
      city: '',
      country: '',
      timezone: 'Asia/Tbilisi',
    });
  });

  it('сбой определения не ломает ход — часы остаются', async () => {
    const { svc } = service(new Error('модель не ответила'));
    await expect(svc.personaPlace(persona('Europe/Madrid'))).resolves.toEqual({
      status: 'resolved',
      city: '',
      country: '',
      timezone: 'Europe/Madrid',
    });
  });

  it('пустая биография — модель не зовём', async () => {
    const { svc, asked } = service(null);
    await expect(
      svc.personaPlace(persona('Europe/Moscow', '')),
    ).resolves.toEqual({
      status: 'resolved',
      city: '',
      country: '',
      timezone: 'Europe/Moscow',
    });
    expect(asked).toEqual([]);
  });
});
