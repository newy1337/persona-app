import { resolve } from 'path';

export const appConfig = {
  personaId: process.env.PERSONA_ID || 'nastya',
  personasDir: resolve(process.env.PERSONAS_DIR || './data/personas'),
  dataDir: resolve(process.env.DATA_DIR || './data'),
  mediaDir: resolve(process.env.DATA_DIR || './data', 'media'),
  tgApiId: Number(process.env.TG_API_ID || 0),
  tgApiHash: process.env.TG_API_HASH || '',
  sessionEncKey: process.env.SESSION_ENC_KEY || '',
  anthropicApiKey: (process.env.ANTHROPIC_API_KEY || '').trim(),
  llmProvider: ((process.env.LLM_PROVIDER || '').trim() === 'openrouter'
    ? 'openrouter'
    : 'anthropic') as 'anthropic' | 'openrouter',
  openrouterApiKey: (process.env.OPENROUTER_API_KEY || '').trim(),
  openaiApiKey: (process.env.OPENAI_API_KEY || '').trim(),
  openaiBaseUrl: (
    process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'
  ).trim(),
  transcribeModel: (
    process.env.TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe'
  ).trim(),
  transcribeLanguage: (process.env.TRANSCRIBE_LANGUAGE ?? 'ru').trim(),
  openrouterBaseUrl:
    process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
  openrouterProviders: (process.env.OPENROUTER_PROVIDERS ?? 'anthropic')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  anthropicWorkspaceId: process.env.ANTHROPIC_WORKSPACE_ID || '',
  generatorModel: process.env.GENERATOR_MODEL || 'claude-sonnet-5',
  judgeModel: (process.env.JUDGE_MODEL || '').trim(),
  judgeEffort: (['low', 'medium', 'high'].includes(
    process.env.JUDGE_EFFORT ?? '',
  )
    ? process.env.JUDGE_EFFORT
    : 'low') as 'low' | 'medium' | 'high',
  adminUsername: process.env.ADMIN_USERNAME || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || '',
  outreachDailyPerAccount: Number(process.env.OUTREACH_DAILY_PER_ACCOUNT || 10),
  outreachMinGapS: Number(process.env.OUTREACH_MIN_GAP_S || 180),
  outreachHours: (process.env.OUTREACH_HOURS_MSK || '10-21')
    .split('-')
    .map(Number) as [number, number],
};

export type AppConfig = typeof appConfig;
