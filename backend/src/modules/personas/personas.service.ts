import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Persona } from '@prisma/client';
import { PrismaService } from 'src/prisma.service';
import { ClockService } from 'src/shared/clock.service';
import {
  PERSONA_SECTIONS,
  PersonaSection,
  PersonaService,
} from 'src/brain/persona.service';
import {
  DEFAULT_PROMPTS,
  PROMPT_KEYS,
  PROMPT_LABELS,
  mergePrompts,
} from 'src/brain/nastya/config/prompts';
import {
  DEFAULT_RHYTHM,
  mergeRhythm,
  rhythmErrors,
} from 'src/brain/nastya/config/rhythm';
import {
  BUILTIN_VARIABLES,
  variableErrors,
} from 'src/brain/nastya/config/variables';
import {
  JUDGE_MODEL_OPTIONS,
  MODEL_OPTIONS,
  generatorModelFor,
  isGeneratorModel,
  isJudgeModel,
  judgeModelFor,
} from 'src/brain/nastya/config/models';
import { appConfig } from 'src/config/app.config';

const COLUMN: Record<PersonaSection, keyof Persona> = {
  persona: 'persona',
  goals: 'goals',
  storylines: 'storylines',
  dayConfig: 'dayConfig',
  beats: 'beats',
  prompts: 'prompts',
  rhythm: 'rhythm',
  variables: 'variables',
};

const MAX_SECTION_BYTES = 512 * 1024;
export const PERSONA_FILE_KIND = 'nastya.persona';
export const PERSONA_FILE_VERSION = 1;
const KEEP_VERSIONS = 20;

const parse = (text: string | null | undefined): any => {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

function slugify(name: string): string {
  const map: Record<string, string> = {
    а: 'a',
    б: 'b',
    в: 'v',
    г: 'g',
    д: 'd',
    е: 'e',
    ё: 'e',
    ж: 'zh',
    з: 'z',
    и: 'i',
    й: 'y',
    к: 'k',
    л: 'l',
    м: 'm',
    н: 'n',
    о: 'o',
    п: 'p',
    р: 'r',
    с: 's',
    т: 't',
    у: 'u',
    ф: 'f',
    х: 'h',
    ц: 'c',
    ч: 'ch',
    ш: 'sh',
    щ: 'sch',
    ъ: '',
    ы: 'y',
    ь: '',
    э: 'e',
    ю: 'yu',
    я: 'ya',
  };
  const s = name
    .toLowerCase()
    .split('')
    .map((ch) => map[ch] ?? ch)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 31);
  return s.length >= 2 ? s : `persona-${Date.now().toString(36)}`;
}

function summary(row: Persona, accounts = 0) {
  const card = parse(row.persona) ?? {};
  const prompts = parse(row.prompts) ?? {};
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    is_default: row.isDefault,
    enabled: row.enabled,
    notes: row.notes,
    generator_model: row.generatorModel ?? null,
    judge_model: row.judgeModel ?? null,
    accounts,
    card_lines: Array.isArray(card.card) ? card.card.length : 0,
    examples: Array.isArray(card.chat_examples) ? card.chat_examples.length : 0,
    storylines: Array.isArray((parse(row.storylines) ?? {}).lines)
      ? parse(row.storylines).lines.length
      : 0,
    edited_prompts: PROMPT_KEYS.filter(
      (k) =>
        typeof prompts[k] === 'string' &&
        prompts[k].trim() !== DEFAULT_PROMPTS[k].trim(),
    ).length,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

@Injectable()
export class PersonasService {
  constructor(
    private prisma: PrismaService,
    private clock: ClockService,
    private personaRuntime: PersonaService,
  ) {}

  private nextStamp(row: Pick<Persona, 'updatedAt'>): number {
    // Любая запись идёт через новую метку: тут же сбрасываем кеш строк у движка.
    this.personaRuntime.forgetRows();
    return Math.max(this.clock.ts(), row.updatedAt + 1);
  }

  private async mustExist(id: number): Promise<Persona> {
    const row = await this.prisma.persona.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('личность не найдена');
    return row;
  }

  private assertSection(section: string): asserts section is PersonaSection {
    if (!(PERSONA_SECTIONS as readonly string[]).includes(section)) {
      throw new BadRequestException(`нет секции «${section}»`);
    }
  }

  private async accountsBySlug(): Promise<Map<string, number>> {
    const rows = await this.prisma.tgAccount.groupBy({
      by: ['personaId'],
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.personaId, r._count._all]));
  }

  async list() {
    const [rows, accounts] = await Promise.all([
      this.prisma.persona.findMany({
        orderBy: [{ isDefault: 'desc' }, { id: 'asc' }],
      }),
      this.accountsBySlug(),
    ]);
    return {
      items: rows.map((r) => summary(r, accounts.get(r.slug) ?? 0)),
      total: rows.length,
    };
  }

  async get(id: number) {
    const row = await this.mustExist(id);
    const accounts = await this.accountsBySlug();
    return {
      ...summary(row, accounts.get(row.slug) ?? 0),
      sections: {
        persona: parse(row.persona) ?? {},
        goals: parse(row.goals) ?? {},
        storylines: parse(row.storylines) ?? {},
        dayConfig: parse(row.dayConfig) ?? {},
        beats: parse(row.beats),
        prompts: parse(row.prompts) ?? {},
        rhythm: mergeRhythm(parse(row.rhythm) ?? {}),
        variables: parse(row.variables) ?? {},
      },
      effective_prompts: mergePrompts(parse(row.prompts) ?? {}),
    };
  }

  async create(dto: { name: string; slug?: string; copy_from?: number }) {
    const slug = dto.slug ?? slugify(dto.name);
    if (await this.prisma.persona.findUnique({ where: { slug } })) {
      throw new ConflictException(`идентификатор «${slug}» уже занят`);
    }
    const src = dto.copy_from ? await this.mustExist(dto.copy_from) : null;
    return this.insert(slug, dto.name, src);
  }

  async duplicate(id: number) {
    const src = await this.mustExist(id);
    const name = `${src.name} (копия)`;
    return this.insert(await this.freeSlug(`${src.slug}-copy`), name, src);
  }

  private async freeSlug(base: string): Promise<string> {
    const head = base.slice(0, 28);
    for (let n = 1; n < 100; n += 1) {
      const slug = n === 1 ? head : `${head}-${n}`;
      if (!(await this.prisma.persona.findUnique({ where: { slug } })))
        return slug;
    }
    return `${head.slice(0, 20)}-${Date.now().toString(36)}`;
  }

  private async insert(slug: string, name: string, src: Persona | null) {
    const now = this.clock.ts();
    const isDefault = (await this.prisma.persona.count()) === 0;
    const row = await this.prisma.persona.create({
      data: {
        slug,
        name,
        isDefault,
        persona: src?.persona ?? '{}',
        goals: src?.goals ?? '{}',
        storylines: src?.storylines ?? '{}',
        dayConfig: src?.dayConfig ?? '{}',
        beats: src?.beats ?? null,
        prompts: JSON.stringify(mergePrompts(parse(src?.prompts) ?? {})),
        rhythm: JSON.stringify({
          ...(src ? mergeRhythm(parse(src.rhythm) ?? {}) : DEFAULT_RHYTHM),
          timezone_mode: 'bio',
        }),
        variables: src?.variables ?? '{}',
        createdAt: now,
        updatedAt: now,
      },
    });
    return this.get(row.id);
  }

  async update(
    id: number,
    dto: {
      name?: string;
      slug?: string;
      enabled?: boolean;
      notes?: string | null;
      generator_model?: string | null;
      judge_model?: string | null;
    },
  ) {
    const row = await this.mustExist(id);
    const { generator_model, judge_model, ...rest } = dto;
    const data: Record<string, unknown> = { ...rest };
    if (generator_model !== undefined) {
      if (generator_model !== null && !isGeneratorModel(generator_model))
        throw new UnprocessableEntityException(
          `неизвестная модель генератора «${generator_model}»`,
        );
      data.generatorModel = generator_model;
    }
    if (judge_model !== undefined) {
      if (judge_model !== null && !isJudgeModel(judge_model))
        throw new UnprocessableEntityException(
          `неизвестная модель судей «${judge_model}»`,
        );
      data.judgeModel = judge_model;
    }
    if (dto.slug && dto.slug !== row.slug) {
      if (await this.prisma.persona.findUnique({ where: { slug: dto.slug } })) {
        throw new ConflictException(`идентификатор «${dto.slug}» уже занят`);
      }
      await this.prisma.tgAccount.updateMany({
        where: { personaId: row.slug },
        data: { personaId: dto.slug },
      });
    }
    if (dto.enabled === false && row.isDefault) {
      throw new UnprocessableEntityException(
        'личность по умолчанию нельзя выключить — сначала назначьте другую',
      );
    }
    await this.prisma.persona.update({
      where: { id },
      data: { ...data, updatedAt: this.nextStamp(row) },
    });
    return this.get(id);
  }

  modelOptions() {
    return {
      generator: MODEL_OPTIONS.map(([id, label]) => ({ id, label })),
      judge: JUDGE_MODEL_OPTIONS.map(([id, label]) => ({ id, label })),
      defaults: {
        generator: generatorModelFor(null, appConfig.generatorModel),
        judge: judgeModelFor(null, appConfig.judgeModel),
      },
    };
  }

  private sectionText(section: PersonaSection, data: unknown): string {
    if (data === null || data === undefined)
      throw new BadRequestException(`пустой документ «${section}»`);
    if (
      section === 'beats'
        ? !Array.isArray(data)
        : typeof data !== 'object' || Array.isArray(data)
    ) {
      throw new UnprocessableEntityException(
        section === 'beats'
          ? 'секция «beats» — массив'
          : `секция «${section}» — объект`,
      );
    }
    if (section === 'prompts')
      this.assertPrompts(data as Record<string, unknown>);
    if (section === 'rhythm') {
      const errors = rhythmErrors(data);
      if (errors.length)
        throw new UnprocessableEntityException(`ритм: ${errors.join('; ')}`);
    }
    if (section === 'variables') {
      const errors = variableErrors(data);
      if (errors.length)
        throw new UnprocessableEntityException(
          `переменные: ${errors.join('; ')}`,
        );
    }
    const text = JSON.stringify(data);
    if (text.length > MAX_SECTION_BYTES)
      throw new UnprocessableEntityException(
        `секция «${section}» больше 512 КБ`,
      );
    return text;
  }

  async putSection(
    id: number,
    section: string,
    data: unknown,
    by?: string,
    note?: string,
  ) {
    this.assertSection(section);
    const row = await this.mustExist(id);
    const text = this.sectionText(
      section,
      section === 'rhythm' && data && typeof data === 'object'
        ? { ...data, timezone_mode: 'manual' }
        : data,
    );

    const previous =
      (row[COLUMN[section]] as string | null) ??
      (section === 'beats' ? '' : '{}');
    if (previous === text)
      return { id, section, saved: false, unchanged: true, bytes: text.length };

    const now = this.clock.ts();
    await this.prisma.$transaction([
      this.prisma.personaVersion.create({
        data: {
          personaId: id,
          section,
          data: previous,
          savedBy: by ?? null,
          note: note ?? null,
          createdAt: now,
        },
      }),
      this.prisma.persona.update({
        where: { id },
        data: { [COLUMN[section]]: text, updatedAt: this.nextStamp(row) },
      }),
    ]);
    await this.pruneVersions(id, section);
    return { id, section, saved: true, bytes: text.length };
  }

  private assertPrompts(data: Record<string, unknown>): void {
    const known = new Set<string>(PROMPT_KEYS);
    for (const [key, value] of Object.entries(data)) {
      if (!known.has(key))
        throw new UnprocessableEntityException(`неизвестный промпт «${key}»`);
      if (typeof value !== 'string')
        throw new UnprocessableEntityException(
          `промпт «${key}» должен быть строкой`,
        );
    }
  }

  private async pruneVersions(
    personaId: number,
    section: PersonaSection,
  ): Promise<void> {
    const stale = await this.prisma.personaVersion.findMany({
      where: { personaId, section },
      orderBy: { id: 'desc' },
      skip: KEEP_VERSIONS,
      select: { id: true },
    });
    if (stale.length) {
      await this.prisma.personaVersion.deleteMany({
        where: { id: { in: stale.map((v) => v.id) } },
      });
    }
  }

  async listVersions(id: number, section: string) {
    this.assertSection(section);
    await this.mustExist(id);
    const rows = await this.prisma.personaVersion.findMany({
      where: { personaId: id, section },
      orderBy: { id: 'desc' },
      select: {
        id: true,
        savedBy: true,
        note: true,
        createdAt: true,
        data: true,
      },
    });
    return {
      items: rows.map((v) => ({
        id: v.id,
        saved_by: v.savedBy,
        note: v.note,
        created_at: v.createdAt,
        bytes: v.data.length,
      })),
    };
  }

  async getVersion(id: number, section: string, versionId: number) {
    this.assertSection(section);
    await this.mustExist(id);
    const v = await this.prisma.personaVersion.findFirst({
      where: { id: versionId, personaId: id, section },
    });
    if (!v) throw new NotFoundException('версия не найдена');
    return {
      id: v.id,
      section,
      saved_by: v.savedBy,
      note: v.note,
      created_at: v.createdAt,
      data: parse(v.data),
    };
  }

  async restoreVersion(
    id: number,
    section: string,
    versionId: number,
    by?: string,
  ) {
    const v = await this.getVersion(id, section, versionId);
    const stamp = new Date(
      (v.created_at ?? this.clock.ts()) * 1000,
    ).toLocaleString('ru-RU');
    return this.putSection(
      id,
      section,
      v.data,
      by,
      `откат к версии от ${stamp}`,
    );
  }

  async setDefault(id: number) {
    const row = await this.mustExist(id);
    if (!row.enabled)
      throw new UnprocessableEntityException(
        'выключенную личность нельзя сделать основной',
      );
    await this.prisma.$transaction([
      this.prisma.persona.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      }),
      this.prisma.persona.update({
        where: { id },
        data: { isDefault: true, updatedAt: this.nextStamp(row) },
      }),
    ]);
    return this.list();
  }

  async remove(id: number) {
    const row = await this.mustExist(id);
    if (row.isDefault)
      throw new UnprocessableEntityException(
        'личность по умолчанию удалить нельзя',
      );
    const accounts = await this.prisma.tgAccount.count({
      where: { personaId: row.slug },
    });
    if (accounts)
      throw new UnprocessableEntityException(
        `личностью говорят ${accounts} аккаунт(ов) — сначала переназначьте их`,
      );
    await this.prisma.persona.delete({ where: { id } });
    return { removed: true, id };
  }

  async exportBundle(id: number) {
    const row = await this.mustExist(id);
    const full = await this.get(id);
    return {
      kind: PERSONA_FILE_KIND,
      version: PERSONA_FILE_VERSION,
      persona: { slug: row.slug, name: row.name },
      exported_at: new Date(this.clock.ts() * 1000).toISOString(),
      sections: full.sections,
    };
  }

  async importBundle(
    id: number,
    sections: Record<string, unknown>,
    by?: string,
    note?: string,
  ) {
    const row = await this.mustExist(id);
    if (!sections || typeof sections !== 'object' || Array.isArray(sections)) {
      throw new UnprocessableEntityException('в файле нет секций личности');
    }
    const entries = Object.entries(sections);
    if (!entries.length)
      throw new UnprocessableEntityException('в файле нет ни одной секции');

    const applied: Array<{ section: PersonaSection; text: string | null }> = [];
    const unchanged: PersonaSection[] = [];
    for (const [name, data] of entries) {
      this.assertSection(name);
      const text =
        name === 'beats' && data === null ? null : this.sectionText(name, data);
      const previous = (row[COLUMN[name]] as string | null) ?? null;
      if (previous === text) unchanged.push(name);
      else applied.push({ section: name, text });
    }

    const now = this.clock.ts();
    const stamp = note?.trim() || 'загрузка из файла';
    if (applied.length) {
      await this.prisma.$transaction([
        ...applied.map(({ section }) =>
          this.prisma.personaVersion.create({
            data: {
              personaId: id,
              section,
              data: (row[COLUMN[section]] as string | null) ?? '',
              savedBy: by ?? null,
              note: stamp,
              createdAt: now,
            },
          }),
        ),
        this.prisma.persona.update({
          where: { id },
          data: {
            ...Object.fromEntries(
              applied.map(({ section, text }) => [COLUMN[section], text]),
            ),
            updatedAt: this.nextStamp(row),
          },
        }),
      ]);
      for (const { section } of applied) await this.pruneVersions(id, section);
    }
    return {
      id,
      applied: applied.map((a) => a.section),
      unchanged,
      persona: await this.get(id),
    };
  }

  builtinVariables() {
    return { builtins: BUILTIN_VARIABLES };
  }

  rhythmDefaults() {
    return { defaults: DEFAULT_RHYTHM };
  }

  promptDefaults() {
    return {
      keys: PROMPT_KEYS,
      labels: PROMPT_LABELS,
      defaults: DEFAULT_PROMPTS,
    };
  }
}
