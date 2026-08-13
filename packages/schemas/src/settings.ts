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
  /**
   * Google Cloud Text-to-Speech, and deliberately separate from `google`.
   *
   * They are two products on two hosts with two enablements: a Gemini API key
   * is refused by `texttospeech.googleapis.com` and a Cloud key is refused by
   * `generativelanguage.googleapis.com`. One credential row for both would mean
   * whichever key you saved last broke the other half of the pipeline.
   *
   * Beyond spec section 4's list, by decision (2026-08-13) — see PROGRESS.md.
   */
  'google-cloud-tts',
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
 * Short model names written by M1 and M2, mapped to the wire ids the adapters
 * use from M3 onward.
 *
 * The list of valid models now lives on each `LLMProvider` adapter (build spec
 * section 6), which this package cannot import — `providers` depends on
 * `schemas`, not the other way round. What remains here is the one thing the
 * adapters cannot supply: a translation for settings rows already sitting in
 * the database. Without it, a console that has been running since M1 would
 * boot with `modelRouting.research.model = 'opus'`, and the router's pre-flight
 * would refuse every research task on a model it has never heard of.
 */
export const LEGACY_MODEL_IDS: Record<LlmProvider, Record<string, string>> = {
  anthropic: {
    opus: 'claude-opus-5',
    sonnet: 'claude-sonnet-5',
    haiku: 'claude-haiku-4-5-20251001',
  },
  openai: {},
  /**
   * `gemini-3-pro` and `gemini-3-flash` were never real. They were written from
   * assumption in M3 and nothing pointed a live key at them until M4, when the
   * Verify button reported a perfectly good key as refused — a 404 for a model
   * that does not exist, presented as "the key was refused".
   *
   * Mapped rather than merely deleted, because a settings row saved while they
   * were on offer would otherwise fail at the router's pre-flight, and this is
   * exactly what that mapping exists for.
   */
  google: {
    'gemini-3-pro': 'gemini-pro-latest',
    'gemini-3-flash': 'gemini-3.6-flash',
    // Retired for new API keys: listed by `GET /models`, then 404 on use.
    'gemini-2.5-pro': 'gemini-pro-latest',
    'gemini-2.5-flash': 'gemini-3.6-flash',
  },
}

/** The stored name brought forward, or the name unchanged if it is current. */
export function canonicalModelId(provider: LlmProvider, model: string): string {
  return LEGACY_MODEL_IDS[provider][model] ?? model
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

export const TTS_PROVIDERS = ['gemini', 'google-cloud-tts', 'elevenlabs'] as const
export const TtsProviderSchema = z.enum(TTS_PROVIDERS)
export type TtsProvider = z.infer<typeof TtsProviderSchema>

/**
 * Which account a TTS provider actually spends against.
 *
 * "Gemini" is a model line, not a vendor: its TTS endpoint takes the same
 * Google API key as the Gemini text models, on the same billing account and
 * behind the same monthly cap. So narration spend has to be attributed to
 * `google`, or the app would keep two budgets for one bill and neither of them
 * would be right.
 *
 * ElevenLabs is its own account, and maps to itself.
 */
export const TTS_CREDENTIAL_PROVIDER: Record<TtsProvider, Provider> = {
  gemini: 'google',
  'google-cloud-tts': 'google-cloud-tts',
  elevenlabs: 'elevenlabs',
}

/** The reverse: which narrator a stored `provider` column refers to. */
export function ttsProviderFromCredential(provider: Provider): TtsProvider | undefined {
  return (Object.keys(TTS_CREDENTIAL_PROVIDER) as TtsProvider[]).find(
    (tts) => TTS_CREDENTIAL_PROVIDER[tts] === provider,
  )
}

/**
 * How a term the model cannot be trusted to say is to be said (spec section 6).
 *
 * This subject matter is full of them — Wirecard, Theranos, Ponzi, Sarbanes-Oxley,
 * the names of foreign regulators — and a narrator that mispronounces the
 * company halfway through a fifteen-minute video is not fixable by editing.
 *
 * Channel-wide rather than per-project: the pronunciation of "Wirecard" is a
 * property of the narrator, not of one video, and re-entering the list per
 * project is how it ends up inconsistent between them.
 */
export const PhonemeHintSchema = z.object({
  /** The written form as it appears in the script. Matched whole-word, case-insensitively. */
  term: z.string().min(1),
  /** How to say it: IPA in slashes, or a plain respelling like "VEER-card". */
  hint: z.string().min(1),
})
export type PhonemeHint = z.infer<typeof PhonemeHintSchema>

/**
 * Only the hints whose term actually appears in this paragraph.
 *
 * **Shared vocabulary, deliberately.** Two places have to agree about which
 * hints apply to a paragraph: the adapter, which sends them to the vendor, and
 * `takeIdempotencyKey`, which folds them into the take's identity so that
 * changing one re-reads the paragraphs it touches. If those two disagreed, a
 * take's key would claim a set of pronunciations the request never carried.
 *
 * A word boundary is wrong at the edges for terms that start or end in punctuation —
 * "S&P 500" and "Sarbanes-Oxley" are both real hint terms in this subject
 * matter — so the boundaries are asserted against letters and digits directly.
 */
export function matchedHints(
  text: string,
  hints: readonly PhonemeHint[],
): readonly PhonemeHint[] {
  return hints.filter((hint) => {
    const term = hint.term.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`(?<![\\p{L}\\p{N}])${term}(?![\\p{L}\\p{N}])`, 'giu').test(text)
  })
}

/**
 * The narration voice. Build spec section 4 calls this `settings.tts` and
 * section 10 calls it `brandKit.voice`; they describe the same fields. It is
 * stored once, here, and projected into the Brand Kit snapshot by
 * `resolveBrandKit()` so the two can never drift.
 *
 * **There is no `locked` flag**, which spec §4 and §11.3 both ask for. It was
 * built, used, and removed: a single-user console has no one to protect the
 * narrator from, so the lock only ever fired on its owner — and it fired on the
 * one screen whose whole purpose is trying voices against each other. What it
 * was guarding against (swapping a brand asset by accident) is a one-press
 * change on a screen you have to navigate to, next to a plain statement of
 * which voice is current. Zod strips the field from any settings row that still
 * carries it.
 */
export const VoiceConfigSchema = z.object({
  provider: TtsProviderSchema,
  voiceId: z.string(),
  stylePrompt: z.string().default(''),
  // Cloud TTS accepts `speakingRate` from 0.25 to 2.0, so the slider offers
  // what the vendor offers rather than a rounder number.
  pacing: z.number().min(0.25).max(2).default(1),
  /**
   * Beyond the five fields section 10 lists, because it belongs to the same
   * decision and nothing else owns it: a hint list is only meaningful next to
   * the voice that will read from it.
   */
  phonemeHints: z.array(PhonemeHintSchema).max(200).default([]),
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

export const MonthKeySchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'must be a YYYY-MM month key')

/**
 * Headroom the human granted at a budget gate (build spec section 6). Stored
 * with the month it applies to, so it expires on its own at the month
 * boundary — an overage approved in March must not quietly raise April's cap.
 */
export const BudgetOverageSchema = z.object({
  month: MonthKeySchema,
  usd: z.number().min(0),
  approvedAt: z.iso.datetime().optional(),
})
export type BudgetOverage = z.infer<typeof BudgetOverageSchema>

/**
 * One number, deliberately.
 *
 * Spec §4 asks for a per-provider cap matrix and a kill switch, and both were
 * built, shipped, and removed by decision (2026-08-13): nine numbers to keep
 * plausible is administration, and the user of a single-user console does not
 * need protecting from themselves provider by provider. What the machinery was
 * actually for — a runaway paid fan-out cannot empty a card — survives intact
 * as a single ceiling on total monthly spend, enforced by the same guard, with
 * the same parking behaviour when a run would cross it.
 *
 * There is no separate kill switch because the ceiling already is one: set it
 * to zero and every priced call parks. `.catch(100)` rather than `.default`,
 * because the production settings row predates this shape and a parse failure
 * here would take the whole app down over a budget field.
 */
export const BudgetsSchema = z.object({
  monthlyCeilingUsd: z.number().min(0).catch(100),
  /** Headroom granted at a budget gate. Expires with its month. */
  approvedOverage: BudgetOverageSchema.optional(),
})
export type Budgets = z.infer<typeof BudgetsSchema>

export const BudgetsPatchSchema = z.object({
  monthlyCeilingUsd: z.number().min(0).optional(),
  approvedOverage: BudgetOverageSchema.nullable().optional(),
})

/** `YYYY-MM` in UTC — the bucket both the ledger and the caps are keyed by. */
export function monthKey(when: Date): string {
  return `${when.getUTCFullYear()}-${String(when.getUTCMonth() + 1).padStart(2, '0')}`
}

/**
 * The cap the guard actually compares against: the configured monthly budget
 * plus any overage approved *for this month*. Pure, so the cap arithmetic is
 * unit-testable without a database.
 */
export function effectiveCeilingUsd(budgets: Budgets, when: Date): number {
  const overage = budgets.approvedOverage
  return overage && overage.month === monthKey(when)
    ? budgets.monthlyCeilingUsd + overage.usd
    : budgets.monthlyCeilingUsd
}

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
  budgets: BudgetsPatchSchema.optional(),
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
  // Spec section 7 assigns the tiers: Opus researches, Sonnet drafts, Haiku
  // does the mechanical passes (self-check, shot list, metadata, digest).
  modelRouting: {
    research: { provider: 'anthropic', model: 'claude-opus-5' },
    scripting: { provider: 'anthropic', model: 'claude-sonnet-5' },
    editing: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
    shotlist: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
    metadata: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
    digest: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
  },
  fallbackChain: [],
  tts: {
    provider: 'google-cloud-tts',
    voiceId: '',
    stylePrompt: '',
    pacing: 1,
    phonemeHints: [],
  },
  // The sum of the old per-provider defaults was $60/month; $100 leaves the
  // same order of magnitude with headroom for a real production month.
  budgets: { monthlyCeilingUsd: 100 },
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
