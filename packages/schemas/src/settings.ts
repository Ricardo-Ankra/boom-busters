import { z } from 'zod'

/**
 * The single-row `settings` table (build spec section 4) plus the Brand Kit
 * tokens (section 10). Everything behavioural lives here rather than in env,
 * so changing a model, a budget or the brand never needs a redeploy.
 */

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

export const LLM_PROVIDERS = ['anthropic', 'openai', 'google'] as const
export const LlmProviderSchema = z.enum(LLM_PROVIDERS)
export type LlmProvider = z.infer<typeof LlmProviderSchema>

export const PROVIDERS = [
  'anthropic',
  'openai',
  'google',
  'elevenlabs',
  'pexels',
  'pixabay',
  'fal',
  'hosted-alignment',
] as const
export const ProviderSchema = z.enum(PROVIDERS)
export type Provider = z.infer<typeof ProviderSchema>

export const LLM_TASKS = [
  'research',
  'scripting',
  'editing',
  'shotlist',
  'metadata',
  'digest',
] as const
export const LlmTaskSchema = z.enum(LLM_TASKS)
export type LlmTask = z.infer<typeof LlmTaskSchema>

/**
 * Model choices offered by the Settings -> Models dropdowns.
 *
 * PROVISIONAL: in M3 each `LLMProvider` adapter exposes its own known-model
 * list (build spec section 6) and this table is replaced by that export. Until
 * then the routing matrix validates against these, and any unlisted model is
 * accepted with a warning rather than rejected, so a newer model can be
 * configured without waiting for a code change.
 */
export const KNOWN_MODELS = {
  anthropic: ['opus', 'sonnet', 'haiku'],
  openai: ['gpt-5', 'gpt-5-mini'],
  google: ['gemini-3-pro', 'gemini-3-flash'],
} as const satisfies Record<LlmProvider, readonly string[]>

export function isKnownModel(provider: LlmProvider, model: string): boolean {
  return (KNOWN_MODELS[provider] as readonly string[]).includes(model)
}

// ---------------------------------------------------------------------------
// Model routing
// ---------------------------------------------------------------------------

export const ModelRefSchema = z.object({
  provider: LlmProviderSchema,
  model: z.string().min(1),
})
export type ModelRef = z.infer<typeof ModelRefSchema>

export const ModelRoutingSchema = z.object({
  research: ModelRefSchema,
  scripting: ModelRefSchema,
  editing: ModelRefSchema,
  shotlist: ModelRefSchema,
  metadata: ModelRefSchema,
  digest: ModelRefSchema,
})
export type ModelRouting = z.infer<typeof ModelRoutingSchema>

/**
 * Optional cross-provider fallback chain used after in-provider tier
 * downgrade fails (build spec section 6).
 */
export const FallbackChainSchema = z.array(LlmProviderSchema).max(2)

// ---------------------------------------------------------------------------
// Voice
// ---------------------------------------------------------------------------

export const TTS_PROVIDERS = ['gemini', 'elevenlabs'] as const
export const TtsProviderSchema = z.enum(TTS_PROVIDERS)
export type TtsProvider = z.infer<typeof TtsProviderSchema>

/**
 * The narration voice. Build spec section 4 calls this `settings.tts` and
 * section 10 calls it `brandKit.voice`; they describe the same five fields.
 * It is stored once, here, and projected into the Brand Kit snapshot by
 * `resolveBrandKit()` so the two can never drift.
 */
export const VoiceConfigSchema = z.object({
  provider: TtsProviderSchema,
  voiceId: z.string(),
  stylePrompt: z.string().default(''),
  pacing: z.number().min(0.5).max(2).default(1),
  /** The voice is a brand asset; unlocking requires typed confirmation in the UI. */
  locked: z.boolean().default(false),
})
export type VoiceConfig = z.infer<typeof VoiceConfigSchema>

// ---------------------------------------------------------------------------
// Brand Kit (build spec section 10)
// ---------------------------------------------------------------------------

const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'must be a #rrggbb hex colour')

export const TypeRoleSchema = z.object({
  family: z.string().min(1),
  weight: z.number().int().min(100).max(900),
  sizeScale: z.number().min(0.5).max(3),
  letterSpacing: z.number().min(-0.1).max(0.5),
  transform: z.enum(['none', 'uppercase', 'capitalize']).default('none'),
})
export type TypeRole = z.infer<typeof TypeRoleSchema>

export const BrandTypographySchema = z.object({
  heading: TypeRoleSchema,
  title: TypeRoleSchema,
  body: TypeRoleSchema,
  /** Tabular lining numerals for charts and money amounts. */
  numbers: TypeRoleSchema,
  captions: TypeRoleSchema,
})

export const BrandColorsSchema = z.object({
  primary: HexColor,
  accent: HexColor,
  background: HexColor,
  surface: HexColor,
  textPrimary: HexColor,
  textSecondary: HexColor,
  /** Ordered and colour-blind safe. */
  chartSeries: z.array(HexColor).min(3).max(12),
  captionHighlight: HexColor,
  semantic: z.object({ collapse: HexColor, recovery: HexColor }),
})

export const BrandLookSchema = z.object({
  logoR2Key: z.string().nullable().default(null),
  watermarkPlacement: z.enum(['none', 'tl', 'tr', 'bl', 'br']).default('br'),
  grainPreset: z.enum(['none', 'subtle', 'film', 'heavy']).default('subtle'),
  lowerThirdVariant: z.enum(['bar', 'stack', 'minimal']).default('bar'),
  chapterCardVariant: z.enum(['full', 'corner', 'minimal']).default('full'),
})

export const BrandMusicSchema = z.object({
  longFormStyle: z.string().default('documentary-tension'),
  shortsStyle: z.string().default('driving'),
  bedGainDb: z.number().min(-60).max(0).default(-25),
  duckDepthDb: z.number().min(-40).max(0).default(-12),
})

/** Stored form: no `voice`, which is projected in from `settings.tts`. */
export const BrandKitStoredSchema = z.object({
  typography: BrandTypographySchema,
  colors: BrandColorsSchema,
  look: BrandLookSchema,
  music: BrandMusicSchema,
})
export type BrandKitStored = z.infer<typeof BrandKitStoredSchema>

/** Resolved form: what a timeline snapshots at compile time (section 8.2). */
export const BrandKitTokensSchema = BrandKitStoredSchema.extend({
  voice: VoiceConfigSchema,
})
export type BrandKitTokens = z.infer<typeof BrandKitTokensSchema>

// ---------------------------------------------------------------------------
// Budgets, render, publish
// ---------------------------------------------------------------------------

export const BudgetsSchema = z.object({
  perProviderMonthlyUSD: z.record(ProviderSchema, z.number().min(0)),
  killSwitch: z.boolean().default(false),
})
export type Budgets = z.infer<typeof BudgetsSchema>

export const RenderSettingsSchema = z.object({
  concurrency: z.number().int().min(1).max(10).default(2),
  timeoutMinutes: z.number().int().min(5).max(180).default(30),
  chapterChunking: z.boolean().default(true),
})

export const ScheduleSlotSchema = z.object({
  kind: z.enum(['longform', 'short']),
  /** 0 = Sunday, per JavaScript's Date.getUTCDay(). */
  weekday: z.number().int().min(0).max(6),
  /** UTC wall time. The UI renders it in the viewer's timezone (section 11.3). */
  timeUtc: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be HH:MM in 24h UTC'),
})
export type ScheduleSlot = z.infer<typeof ScheduleSlotSchema>

export const PublishSettingsSchema = z.object({
  defaultScheduleSlots: z.array(ScheduleSlotSchema).max(21),
  /**
   * Until YouTube's API compliance audit passes, the publish screen shows a
   * manual "flip to public in Studio" checklist instead of pretending the API
   * can do it (build spec section 9).
   */
  apiAuditPassed: z.boolean().default(false),
  /** videos.insert costs 1600 units against a 10k/day default quota. */
  dailyUploadBudget: z.number().int().min(1).max(6).default(4),
})

// ---------------------------------------------------------------------------
// Feature flags
// ---------------------------------------------------------------------------

export const FeatureFlagsSchema = z.object({
  /**
   * `hero` (AI video) slots are off at launch: the schema, brief type and UI
   * badge exist but no video-generation adapter is built, and the shot-list
   * prompt is told not to emit hero slots while this is false (section 5).
   */
  heroSlots: z.boolean().default(false),
})

// ---------------------------------------------------------------------------
// The settings row
// ---------------------------------------------------------------------------

export const SettingsSchema = z.object({
  modelRouting: ModelRoutingSchema,
  fallbackChain: FallbackChainSchema.default([]),
  tts: VoiceConfigSchema,
  budgets: BudgetsSchema,
  render: RenderSettingsSchema,
  publish: PublishSettingsSchema,
  brandKit: BrandKitStoredSchema,
  features: FeatureFlagsSchema,
})
export type Settings = z.infer<typeof SettingsSchema>

/** Deep-partial patch accepted by the settings update action. */
export const SettingsPatchSchema = z.object({
  modelRouting: ModelRoutingSchema.partial().optional(),
  fallbackChain: FallbackChainSchema.optional(),
  tts: VoiceConfigSchema.partial().optional(),
  budgets: BudgetsSchema.partial().optional(),
  render: RenderSettingsSchema.partial().optional(),
  publish: PublishSettingsSchema.partial().optional(),
  brandKit: BrandKitStoredSchema.partial().optional(),
  features: FeatureFlagsSchema.partial().optional(),
})
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>

// ---------------------------------------------------------------------------
// Defaults (build spec section 4; channel defaults from section 2 of the
// product spec)
// ---------------------------------------------------------------------------

const defaultTypeRole = (family: string, weight: number, sizeScale = 1): TypeRole => ({
  family,
  weight,
  sizeScale,
  letterSpacing: 0,
  transform: 'none',
})

export const DEFAULT_SETTINGS: Settings = {
  modelRouting: {
    research: { provider: 'anthropic', model: 'opus' },
    scripting: { provider: 'anthropic', model: 'sonnet' },
    editing: { provider: 'anthropic', model: 'haiku' },
    shotlist: { provider: 'anthropic', model: 'haiku' },
    metadata: { provider: 'anthropic', model: 'haiku' },
    digest: { provider: 'anthropic', model: 'haiku' },
  },
  fallbackChain: [],
  tts: {
    provider: 'gemini',
    voiceId: '',
    stylePrompt: '',
    pacing: 1,
    locked: false,
  },
  budgets: {
    perProviderMonthlyUSD: {
      anthropic: 30,
      openai: 10,
      google: 15,
      elevenlabs: 0,
      pexels: 0,
      pixabay: 0,
      fal: 0,
      'hosted-alignment': 0,
    },
    killSwitch: false,
  },
  render: { concurrency: 2, timeoutMinutes: 30, chapterChunking: true },
  publish: {
    defaultScheduleSlots: [
      { kind: 'longform', weekday: 5, timeUtc: '15:00' },
      { kind: 'short', weekday: 6, timeUtc: '16:00' },
      { kind: 'short', weekday: 1, timeUtc: '16:00' },
      { kind: 'short', weekday: 3, timeUtc: '16:00' },
    ],
    apiAuditPassed: false,
    dailyUploadBudget: 4,
  },
  brandKit: {
    typography: {
      heading: defaultTypeRole('Inter', 700, 1.4),
      title: defaultTypeRole('Inter', 600, 1.2),
      body: defaultTypeRole('Inter', 400),
      numbers: defaultTypeRole('JetBrains Mono', 500),
      captions: defaultTypeRole('Inter', 700, 1.1),
    },
    colors: {
      primary: '#0f1115',
      accent: '#f5a524',
      background: '#0a0a0b',
      surface: '#16181d',
      textPrimary: '#f4f4f5',
      textSecondary: '#a1a1aa',
      chartSeries: ['#f5a524', '#3b82f6', '#10b981', '#a855f7', '#ef4444', '#14b8a6'],
      captionHighlight: '#f5a524',
      semantic: { collapse: '#ef4444', recovery: '#10b981' },
    },
    look: {
      logoR2Key: null,
      watermarkPlacement: 'br',
      grainPreset: 'subtle',
      lowerThirdVariant: 'bar',
      chapterCardVariant: 'full',
    },
    music: {
      longFormStyle: 'documentary-tension',
      shortsStyle: 'driving',
      bedGainDb: -25,
      duckDepthDb: -12,
    },
  },
  features: { heroSlots: false },
}

/**
 * The Brand Kit as consumed by compositions: stored tokens plus the narration
 * voice projected in from `settings.tts` (see `VoiceConfigSchema`).
 */
export function resolveBrandKit(settings: Settings): BrandKitTokens {
  return { ...settings.brandKit, voice: settings.tts }
}

/**
 * Gate on starting a project: build spec section 11.3 blocks the pipeline
 * until the voice, Brand Kit and music beds are set up. Music beds live in
 * `assets`, so the caller supplies that count.
 */
export function firstRunBlockers(settings: Settings, musicBedCount: number): string[] {
  const blockers: string[] = []
  if (settings.tts.voiceId.trim() === '') blockers.push('narration-voice')
  if (settings.brandKit.colors.chartSeries.length < 3) blockers.push('brand-kit')
  if (musicBedCount < 3) blockers.push('music-beds')
  return blockers
}
