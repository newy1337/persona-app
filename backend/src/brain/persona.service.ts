import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { createOpenRouterClient } from './nastya/llm/openrouter';
import { appConfig } from 'src/config/app.config';
import { PrismaService } from 'src/prisma.service';
import { ClockService } from 'src/shared/clock.service';
import { toChatId } from 'src/utils/ids';
import type { CharacterConfig } from './nastya/kernel/types';
import {
  DEFAULT_PROMPTS,
  PROMPT_KEYS,
  mergePrompts,
  type PersonaPrompts,
} from './nastya/config/prompts';
import {
  DEFAULT_RHYTHM,
  mergeRhythm,
  type Rhythm,
} from './nastya/config/rhythm';
import {
  chatVariables,
  fillVariables,
  variableValues,
  withoutChatVariables,
} from './nastya/config/variables';
import { parseLeadFacts } from 'src/domain/lead-facts';
import { UsageRecorderService } from './usage-recorder.service';
import {
  LocationResolver,
  LOCATION_RULES,
} from './nastya/kernel/location-resolver';
import { type Place, unknownPlace } from './nastya/kernel/location';
import { completeText } from './nastya/llm/anthropic';
import { resolveModel } from './nastya/config/models';
import { parseJsonObject } from './nastya/judge/transport';

export const PERSONA_SECTIONS = [
  'persona',
  'goals',
  'storylines',
  'dayConfig',
  'beats',
  'prompts',
  'rhythm',
  'variables',
] as const;
export type PersonaSection = (typeof PERSONA_SECTIONS)[number];

export interface LoadedPersona {
  enabled?: boolean;
  locationIssue?: string;
  id: number;
  slug: string;
  name: string;
  config: CharacterConfig;
  prompts: PersonaPrompts;
  rhythm: Rhythm;
  variables: Record<string, string>;
  beats: Record<string, unknown>[] | null;
  updatedAt: number;
  /** Биография как она лежит в базе — ключ кеша определения места. */
  personaSource: string;
  /** пусто — модель из окружения */
  generatorModel?: string | null;
  judgeModel?: string | null;
}

interface RawPersona {
  id: number;
  slug: string;
  name: string;
  updatedAt: number;
  docs: {
    persona: Record<string, any>;
    day: Record<string, any>;
    goals: Record<string, any>;
    storylines: Record<string, any>;
  };
  prompts: PersonaPrompts;
  rhythm: Rhythm;
  beats: Record<string, unknown>[] | null;
  variables: Record<string, string>;
  views: Map<string, LoadedPersona>;
}

const MAX_VIEWS = 300;

const json = (text: string | null | undefined): Record<string, any> => {
  if (!text) return {};
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value
      : {};
  } catch {
    return {};
  }
};

@Injectable()
export class PersonaService implements OnModuleInit {
  private readonly log = new Logger(PersonaService.name);
  private readonly cache = new Map<string, RawPersona>();

  readonly provider = appConfig.llmProvider;

  readonly anthropic: Anthropic =
    appConfig.llmProvider === 'openrouter'
      ? createOpenRouterClient({
          apiKey: appConfig.openrouterApiKey || 'missing',
          baseUrl: appConfig.openrouterBaseUrl,
          providers: appConfig.openrouterProviders,
          timeoutMs: 180_000,
          maxRetries: 2,
          title: 'Nastya panel',
        })
      : new Anthropic({
          apiKey: appConfig.anthropicApiKey || 'missing',
          timeout: 180_000,
          maxRetries: 2,
          ...(appConfig.anthropicWorkspaceId
            ? {
                defaultHeaders: {
                  'anthropic-workspace-id': appConfig.anthropicWorkspaceId,
                },
              }
            : {}),
        });

  constructor(
    private prisma: PrismaService,
    private clock: ClockService,
    private usage: UsageRecorderService,
  ) {}

  private locations = new LocationResolver(
    {
      get: (key) => this.prisma.setting.findUnique({ where: { key } }),
      set: async (key, value, updatedAt) => {
        await this.prisma.setting.upsert({
          where: { key },
          create: { key, value, updatedAt },
          update: { value, updatedAt },
        });
      },
    },
    async (source) => {
      if (!this.ready)
        throw new Error('Location resolver requires the configured model');
      const logger = {
        info: (m: string) => this.log.log(m),
        warn: (m: string) => this.log.warn(m),
        error: (m: string) => this.log.error(m),
      };
      const text = await completeText(
        {
          client: this.anthropic,
          usageDb: this.usage,
          logger,
          provider: this.provider,
        },
        {
          model: resolveModel(appConfig.generatorModel),
          system: { stable: LOCATION_RULES },
          messages: [{ role: 'user', content: source }],
          maxTokens: 600,
          effort: 'off',
          stage: 'time_location',
        },
      );
      return parseJsonObject(text);
    },
  );

  async interlocutorLocation(source: string): Promise<Place> {
    return this.locations.resolve('interlocutor', source);
  }

  /**
   * Где личность находится сейчас — для её собственных часов. Часовой пояс
   * берём настроенный: при режиме «по биографии» он уже из неё и выведен, при
   * ручном — так решил оператор, и выдумывать за него город другого пояса
   * нельзя. Город нужен, чтобы модель не гадала по биографии, в каком из
   * упомянутых там мест персонаж сейчас.
   */
  async personaPlace(persona: LoadedPersona): Promise<Place> {
    const timezone = persona.rhythm.timezone;
    const blank: Place = {
      status: 'resolved',
      city: '',
      country: '',
      timezone,
    };
    if (!persona.personaSource) return blank;
    const place = await this.locations
      .resolve('persona', persona.personaSource)
      .catch(() => unknownPlace());
    return place.status === 'resolved' && place.timezone === timezone
      ? { ...place, timezone }
      : blank;
  }

  get ready(): boolean {
    return Boolean(
      appConfig.llmProvider === 'openrouter'
        ? appConfig.openrouterApiKey
        : appConfig.anthropicApiKey,
    );
  }

  async onModuleInit(): Promise<void> {
    this.log.log(
      appConfig.llmProvider === 'openrouter'
        ? `LLM via OpenRouter (providers: ${appConfig.openrouterProviders.join(', ') || 'any'})${appConfig.openrouterApiKey ? '' : ' — OPENROUTER_API_KEY is empty'}`
        : `LLM via Anthropic API${appConfig.anthropicApiKey ? '' : ' — ANTHROPIC_API_KEY is empty'}`,
    );
    await this.seedFromFiles();
    await this.fillPrompts();
  }

  private async fillPrompts(): Promise<void> {
    const rows = await this.prisma.persona.findMany({
      select: { id: true, slug: true, prompts: true, rhythm: true },
    });
    for (const row of rows) {
      const own = json(row.prompts);
      if (
        !PROMPT_KEYS.every(
          (key) => typeof own[key] === 'string' && own[key].trim(),
        )
      ) {
        await this.prisma.persona.update({
          where: { id: row.id },
          data: { prompts: JSON.stringify(mergePrompts(own)) },
        });
        this.log.log(
          `личность «${row.slug}»: тексты промптов дописаны из кода`,
        );
      }
      const rhythm = json(row.rhythm);
      const full = Object.keys(rhythm).length
        ? mergeRhythm(rhythm)
        : DEFAULT_RHYTHM;
      const missing = Object.keys(full).filter((key) => !(key in rhythm));
      if (missing.length) {
        await this.prisma.persona.update({
          where: { id: row.id },
          data: { rhythm: JSON.stringify({ ...full, ...rhythm }) },
        });
        this.log.log(
          `личность «${row.slug}»: ритм дополнен умолчаниями (${missing.join(', ')})`,
        );
      }
    }
  }

  private async seedFromFiles(): Promise<void> {
    if ((await this.prisma.persona.count()) > 0) return;
    const root = appConfig.personasDir;
    if (!existsSync(root)) return;
    const dirs = readdirSync(root).filter(
      (name) =>
        statSync(join(root, name)).isDirectory() &&
        existsSync(join(root, name, 'persona.json')),
    );
    if (!dirs.length) return;

    const now = this.clock.ts();
    for (const slug of dirs) {
      const dir = join(root, slug);
      const file = (name: string) =>
        existsSync(join(dir, `${name}.json`))
          ? readFileSync(join(dir, `${name}.json`), 'utf8')
          : null;
      const personaDoc = file('persona') ?? '{}';
      await this.prisma.persona.create({
        data: {
          slug,
          name: String(json(personaDoc).name ?? slug),
          isDefault: slug === appConfig.personaId || dirs.length === 1,
          persona: personaDoc,
          goals: file('goals') ?? '{}',
          storylines: file('storylines') ?? '{}',
          dayConfig: file('day') ?? '{}',
          beats: file('beats'),
          prompts: JSON.stringify(DEFAULT_PROMPTS),
          rhythm: JSON.stringify(DEFAULT_RHYTHM),
          createdAt: now,
          updatedAt: now,
        },
      });
      this.log.log(`личность «${slug}» импортирована из ${dir}`);
    }
    if (!(await this.prisma.persona.count({ where: { isDefault: true } }))) {
      const first = await this.prisma.persona.findFirst({
        orderBy: { id: 'asc' },
      });
      if (first)
        await this.prisma.persona.update({
          where: { id: first.id },
          data: { isDefault: true },
        });
    }
  }

  private raw(row: {
    id: number;
    slug: string;
    name: string;
    persona: string;
    goals: string;
    storylines: string;
    dayConfig: string;
    beats: string | null;
    prompts: string;
    rhythm: string;
    variables: string;
    updatedAt: number;
  }): RawPersona {
    const cached = this.cache.get(row.slug);
    if (cached && cached.updatedAt === row.updatedAt && cached.id === row.id)
      return cached;
    const beatsDoc = row.beats ? JSON.parse(row.beats) : null;
    const raw: RawPersona = {
      id: row.id,
      slug: row.slug,
      name: row.name || row.slug,
      updatedAt: row.updatedAt,
      docs: {
        persona: json(row.persona),
        day: json(row.dayConfig),
        goals: json(row.goals),
        storylines: json(row.storylines),
      },
      prompts: mergePrompts(json(row.prompts)),
      rhythm: mergeRhythm(json(row.rhythm)),
      beats: Array.isArray(beatsDoc) ? beatsDoc : null,
      variables: variableValues(json(row.variables)),
      views: new Map(),
    };
    this.cache.set(row.slug, raw);
    return raw;
  }

  private materialise(
    row: Parameters<PersonaService['raw']>[0] & {
      enabled?: boolean;
      generatorModel?: string | null;
      judgeModel?: string | null;
    },
    chat: Record<string, string> = {},
  ): LoadedPersona {
    const raw = this.raw(row);
    const variables = { ...raw.variables, ...chat, name: raw.name };
    const shared = withoutChatVariables(variables);
    const key = JSON.stringify(
      Object.entries(shared).sort(([a], [b]) => a.localeCompare(b)),
    );
    const models = {
      generatorModel: row.generatorModel ?? null,
      judgeModel: row.judgeModel ?? null,
    };
    const ready = raw.views.get(key);
    if (ready)
      return { ...ready, ...models, variables, enabled: row.enabled !== false };
    const fill = <T>(doc: T): T => fillVariables(doc, shared);
    const loaded: LoadedPersona = {
      id: raw.id,
      slug: raw.slug,
      name: raw.name,
      config: {
        timeZone: raw.rhythm.timezone,
        persona: fill(raw.docs.persona),
        day: fill(raw.docs.day),
        goals: fill(raw.docs.goals),
        storylines: fill(raw.docs.storylines),
      },
      prompts: fill(raw.prompts),
      rhythm: raw.rhythm,
      variables,
      beats: raw.beats ? fill(raw.beats) : null,
      updatedAt: raw.updatedAt,
      personaSource: row.persona,
    };
    if (raw.views.size >= MAX_VIEWS) raw.views.clear();
    raw.views.set(key, loaded);
    return { ...loaded, ...models, variables, enabled: row.enabled !== false };
  }

  /** Город и сайт лида из карточки диалога — переменные `{city}` и `{site}` этого чата. */
  private async chatVars(
    chatId: number | null | undefined,
  ): Promise<Record<string, string>> {
    if (chatId == null) return {};
    const row = await this.prisma.leadFacts.findUnique({
      where: { chatId: toChatId(chatId) },
      select: { facts: true },
    });
    return chatVariables(parseLeadFacts(row?.facts));
  }

  async bySlug(slug: string): Promise<LoadedPersona> {
    const row = await this.prisma.persona.findUnique({ where: { slug } });
    if (!row) throw new NotFoundException(`личность «${slug}» не найдена`);
    return this.materialise(row);
  }

  private async defaultRow() {
    const row =
      (await this.prisma.persona.findFirst({
        where: { isDefault: true, enabled: true },
      })) ??
      (await this.prisma.persona.findFirst({
        where: { enabled: true },
        orderBy: { id: 'asc' },
      }));
    if (!row)
      throw new NotFoundException(
        'в базе нет ни одной личности — заведите её в панели',
      );
    return row;
  }

  /** Личность по умолчанию: ею говорят чаты без своего аккаунта или без привязки. */
  async default(): Promise<LoadedPersona> {
    return this.materialise(await this.defaultRow());
  }

  /**
   * Личность аккаунта: `tg_accounts.persona_id` — это slug. С `chatId` — в разрезе
   * диалога: `{city}` и `{site}` берутся из карточки этого лида.
   */
  async forAccount(
    accountId: number | null | undefined,
    chatId?: number | null,
  ): Promise<LoadedPersona> {
    const chat = await this.chatVars(chatId);
    const fallback = async () => {
      const row = await this.defaultRow();
      return this.withCurrentLocation(row, chat);
    };
    if (accountId == null) return fallback();
    const account = await this.prisma.tgAccount.findUnique({
      where: { id: accountId },
      select: { personaId: true },
    });
    if (!account?.personaId)
      throw new NotFoundException('У аккаунта не задана личность');
    const row = await this.prisma.persona.findUnique({
      where: { slug: account.personaId },
    });
    if (!row)
      throw new NotFoundException(
        'Привязанная личность не найдена — автоматические ответы остановлены',
      );
    return this.withCurrentLocation(row, chat);
  }

  private async withCurrentLocation(
    row: any,
    chat: Record<string, string>,
  ): Promise<LoadedPersona> {
    const loaded = this.materialise(row, chat);
    if (json(row.rhythm).timezone_mode !== 'bio' || row.enabled === false)
      return loaded;
    const place = await this.locations.resolve('persona', row.persona);
    if (place.status !== 'resolved')
      return {
        ...loaded,
        locationIssue:
          'Не удалось определить текущее место личности. Укажите, где она сейчас живёт, в биографии или сохраните часовой пояс вручную в разделе «Ритм».',
      };
    const rhythm = { ...loaded.rhythm, timezone: place.timezone };
    let effectiveStamp = row.updatedAt;
    if (loaded.rhythm.timezone !== place.timezone) {
      const updatedAt = Math.max(row.updatedAt + 1, this.clock.ts());
      const changed = await this.prisma.persona.updateMany({
        where: {
          id: row.id,
          updatedAt: row.updatedAt,
          rhythm: row.rhythm,
          persona: row.persona,
        },
        data: {
          rhythm: JSON.stringify({
            ...json(row.rhythm),
            timezone: place.timezone,
          }),
          updatedAt,
        },
      });
      if (!changed.count) {
        const latest = await this.prisma.persona.findUnique({
          where: { id: row.id },
        });
        if (!latest) throw new NotFoundException('Личность удалена');
        return this.withCurrentLocation(latest, chat);
      }
      effectiveStamp = updatedAt;
    }
    return {
      ...loaded,
      updatedAt: effectiveStamp,
      rhythm,
      config: { ...loaded.config, timeZone: place.timezone },
    };
  }

  /** Кто говорит в этом чате: аккаунт-владелец решает, карточка лида даёт `{city}` и `{site}`. */
  async forChat(chatId: number): Promise<LoadedPersona> {
    const contact = await this.prisma.contact.findUnique({
      where: { chatId: toChatId(chatId) },
      select: { accountId: true },
    });
    return this.forAccount(contact?.accountId ?? null, chatId);
  }
}
