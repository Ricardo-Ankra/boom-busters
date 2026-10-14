import type { ChartKind, ChartSeries } from '@boom-busters/schemas'

/**
 * The exemplar corpus (decision 305): one hand-written entry per technique
 * the channel uses, each naming the MIT-licensed Remotion template it is
 * translated from (vendored byte for byte under `vendored/`, with the
 * repository's licence beside it) and a small synthetic slot that the
 * translation and the corpus test share. The translated designs live in
 * `designs/`; `exemplarFor` joins the two.
 */

export const TECHNIQUES = [
  'stat-counter',
  'kpi-counter',
  'bar-chart',
  'line-chart',
  'racing-chart',
  'comparison-chart',
  'donut-chart',
  'progress-bars',
  'progress-steps',
  'kinetic-word-stack',
  'typewriter',
  'text-highlight',
  'quote-card',
  'animated-list',
  'lower-third',
  'chapter-title',
  'logo-reveal',
  'split-screen',
] as const
export type Technique = (typeof TECHNIQUES)[number]

export interface ExemplarSlot {
  durationMs: number
  /** The narration on the slot's clock, as `props.words` carries it. */
  words: readonly { text: string; atMs: number }[]
  /** What the viewer must take away; the slot message's Intent line. */
  intent: string
  /** A chart technique's `props.data`. */
  data?: {
    series: ChartSeries[]
    takeaway: string
    annotations?: { atX: string; text: string }[]
  }
}

export interface ExemplarEntry {
  id: Technique
  technique: Technique
  /** One line the prompt shows beside the technique's name. */
  description: string
  source: { repo: 'rendercomp' | 'rve'; path: string; commit: string }
  /** A chart technique: its slot carries data and its brief is a chart brief. */
  chart?: { kind: ChartKind }
  slot: ExemplarSlot
}

const RENDERCOMP = 'f648980e528defb7594e24c6447055f0540f340b'
const RVE = '6209b724798e48ff395f8df1a6fa2d26082372b5'

const rendercomp = (path: string) => ({ repo: 'rendercomp' as const, path, commit: RENDERCOMP })
const rve = (path: string) => ({ repo: 'rve' as const, path, commit: RVE })

/** Words spread evenly from `fromMs`, `stepMs` apart. */
const spoken = (text: string, fromMs: number, stepMs: number) =>
  text.split(' ').map((word, index) => ({ text: word, atMs: fromMs + index * stepMs }))

/** One series of yearly points, for the chart techniques. */
const yearly = (label: string, unit: string, values: readonly [string, number][]): ChartSeries => ({
  label,
  unit,
  points: values.map(([x, y]) => ({ x, y })),
})

export const MANIFEST: readonly ExemplarEntry[] = [
  {
    id: 'stat-counter',
    technique: 'stat-counter',
    description: 'one large figure counting up to its mark, a label beneath, held',
    source: rve('templates/stat-counter.tsx'),
    slot: {
      durationMs: 6000,
      words: spoken('The company had raised 1.2bn by the end of the year.', 200, 450),
      intent: 'The 1.2bn is the whole story of the year.',
    },
  },
  {
    id: 'kpi-counter',
    technique: 'kpi-counter',
    description: 'three figures counting up side by side, each with its label, the hero last',
    source: rendercomp('src/components/kpi-counter/KpiCounter.tsx'),
    slot: {
      durationMs: 8000,
      words: spoken('Revenue of 4.2bn, a loss of 900m, and 12,000 staff gone.', 200, 500),
      intent: 'Three figures tell the collapse: 4.2bn revenue, a 900m loss, 12,000 staff gone.',
    },
  },
  {
    id: 'bar-chart',
    technique: 'bar-chart',
    description: 'bars drawn on one by one as their years are spoken, the last in the accent',
    source: rendercomp('src/components/bar-chart-anim/BarChartAnim.tsx'),
    chart: { kind: 'bar' },
    slot: {
      durationMs: 8000,
      words: [
        { text: 'In', atMs: 300 },
        { text: '2019', atMs: 600 },
        { text: 'then', atMs: 2000 },
        { text: '2020', atMs: 2400 },
        { text: 'then', atMs: 3800 },
        { text: '2021', atMs: 4200 },
        { text: 'and', atMs: 5400 },
        { text: '2022', atMs: 5800 },
        { text: 'the', atMs: 6600 },
        { text: 'debt', atMs: 6800 },
        { text: 'grew.', atMs: 7100 },
      ],
      intent: 'The debt grew every year.',
      data: {
        series: [
          yearly('Debt', 'bn', [
            ['2019', 1.1],
            ['2020', 1.8],
            ['2021', 2.6],
            ['2022', 4.0],
          ]),
        ],
        takeaway: 'The debt grew every year',
        annotations: [{ atX: '2022', text: 'Default' }],
      },
    },
  },
  {
    id: 'line-chart',
    technique: 'line-chart',
    description: 'a line drawn across the frame point by point, the last value called out',
    source: rendercomp('src/components/line-chart-anim/LineChartAnim.tsx'),
    chart: { kind: 'line' },
    slot: {
      durationMs: 8000,
      words: [
        { text: 'The', atMs: 300 },
        { text: 'share', atMs: 500 },
        { text: 'price', atMs: 800 },
        { text: 'fell', atMs: 1200 },
        { text: 'from', atMs: 1600 },
        { text: '2019', atMs: 2000 },
        { text: 'to', atMs: 3400 },
        { text: '2020', atMs: 3800 },
        { text: 'to', atMs: 5000 },
        { text: '2021', atMs: 5400 },
        { text: 'to', atMs: 6400 },
        { text: '2022.', atMs: 6800 },
      ],
      intent: 'The share price fell every year.',
      data: {
        series: [
          yearly('Share price', 'USD', [
            ['2019', 98],
            ['2020', 71],
            ['2021', 34],
            ['2022', 6],
          ]),
        ],
        takeaway: 'The share price fell every year',
        annotations: [{ atX: '2022', text: 'Delisted' }],
      },
    },
  },
  {
    id: 'racing-chart',
    technique: 'racing-chart',
    description: 'horizontal bars that grow and reorder as the years pass, the leader on top',
    source: rendercomp('src/components/racing-chart/RacingChart.tsx'),
    chart: { kind: 'bar' },
    slot: {
      durationMs: 10000,
      words: [
        { text: 'Year', atMs: 300 },
        { text: 'by', atMs: 500 },
        { text: 'year', atMs: 700 },
        { text: '2017', atMs: 1200 },
        { text: '2018', atMs: 2600 },
        { text: '2019', atMs: 4000 },
        { text: '2020', atMs: 5400 },
        { text: '2021', atMs: 6800 },
        { text: 'the', atMs: 8000 },
        { text: 'fund', atMs: 8200 },
        { text: 'grew.', atMs: 8500 },
      ],
      intent: 'The fund grew every year for five years.',
      data: {
        // Three funds over five years, so the bars have something to reorder:
        // A leads, then B, then C, then C over A, then A again.
        series: [
          yearly('Fund A', 'bn', [
            ['2017', 12],
            ['2018', 13],
            ['2019', 14],
            ['2020', 18],
            ['2021', 22],
          ]),
          yearly('Fund B', 'bn', [
            ['2017', 8],
            ['2018', 14],
            ['2019', 16],
            ['2020', 17],
            ['2021', 18],
          ]),
          yearly('Fund C', 'bn', [
            ['2017', 5],
            ['2018', 7],
            ['2019', 17],
            ['2020', 19],
            ['2021', 20],
          ]),
        ],
        takeaway: 'The fund grew every year',
      },
    },
  },
  {
    id: 'comparison-chart',
    technique: 'comparison-chart',
    description: 'two series side by side per year, the gap between them the point',
    source: rve('templates/comparison-chart.tsx'),
    chart: { kind: 'bar' },
    slot: {
      durationMs: 8000,
      words: [
        { text: 'Reported', atMs: 300 },
        { text: 'against', atMs: 800 },
        { text: 'real', atMs: 1200 },
        { text: 'in', atMs: 1800 },
        { text: '2020', atMs: 2200 },
        { text: 'and', atMs: 3800 },
        { text: '2021', atMs: 4200 },
        { text: 'and', atMs: 5600 },
        { text: '2022.', atMs: 6000 },
      ],
      intent: 'What was reported was never what was real.',
      data: {
        series: [
          yearly('Reported', 'bn', [
            ['2020', 2.0],
            ['2021', 2.8],
            ['2022', 3.5],
          ]),
          yearly('Real', 'bn', [
            ['2020', 0.9],
            ['2021', 0.7],
            ['2022', 0.2],
          ]),
        ],
        takeaway: 'Reported was never real',
      },
    },
  },
  {
    id: 'donut-chart',
    technique: 'donut-chart',
    description: 'a ring that fills to a percentage, the figure counting up inside it',
    source: rve('templates/donut-chart.tsx'),
    slot: {
      durationMs: 6000,
      words: spoken('Forty per cent of the money, 40%, was simply gone.', 200, 450),
      intent: '40% of the money was gone.',
    },
  },
  {
    id: 'progress-bars',
    technique: 'progress-bars',
    description: 'labelled bars filling to their share, one after another',
    source: rve('templates/progress-bars.tsx'),
    slot: {
      durationMs: 7000,
      words: spoken('Banks held 60%, funds 30%, and the public 10%.', 200, 500),
      intent: 'Banks held 60%, funds 30%, the public 10%.',
    },
  },
  {
    id: 'progress-steps',
    technique: 'progress-steps',
    description: 'numbered steps lighting up in turn along a line',
    source: rve('templates/progress-steps.tsx'),
    slot: {
      durationMs: 8000,
      words: spoken(
        'First the loan, second the shell company, third the transfer, fourth the silence.',
        200,
        500,
      ),
      intent: 'Four steps: the loan, the shell company, the transfer, the silence.',
    },
  },
  {
    id: 'kinetic-word-stack',
    technique: 'kinetic-word-stack',
    description: 'words stacking in as they are spoken, the last one the biggest',
    source: rendercomp('src/components/kinetic-word-stack/KineticWordStack.tsx'),
    slot: {
      durationMs: 6000,
      words: spoken('Nobody asked. Nobody checked. Nobody knew.', 300, 550),
      intent: 'Nobody asked, nobody checked, nobody knew.',
    },
  },
  {
    id: 'typewriter',
    technique: 'typewriter',
    description: 'a line typed out character by character with a cursor, then held',
    source: rendercomp('src/components/typewriter/Typewriter.tsx'),
    slot: {
      durationMs: 6000,
      words: spoken('The email said: delete everything tonight.', 300, 600),
      intent: 'The email said to delete everything tonight.',
    },
  },
  {
    id: 'text-highlight',
    technique: 'text-highlight',
    description: 'one phrase in a sentence swept with a highlight as it is said',
    source: rve('templates/text-highlight.tsx'),
    slot: {
      durationMs: 5000,
      words: spoken('The auditors signed off every single year.', 300, 500),
      intent: 'The auditors signed off every single year.',
    },
  },
  {
    id: 'quote-card',
    technique: 'quote-card',
    description: 'a quotation in large type with its attribution beneath, entering as it is read',
    source: rve('templates/quote-card.tsx'),
    slot: {
      durationMs: 7000,
      words: spoken('"We never saw the money," the chairman told the court.', 300, 500),
      intent: 'The chairman told the court they never saw the money.',
    },
  },
  {
    id: 'animated-list',
    technique: 'animated-list',
    description: 'a list whose items enter one at a time with a marker',
    source: rve('templates/animated-list.tsx'),
    slot: {
      durationMs: 7000,
      words: spoken('Three banks, two funds, one regulator, and no questions.', 300, 500),
      intent: 'Three banks, two funds, one regulator, no questions.',
    },
  },
  {
    id: 'lower-third',
    technique: 'lower-third',
    description: 'a name and a role in a band at the bottom of the frame, sliding in and holding',
    source: rve('templates/lower-third.tsx'),
    slot: {
      durationMs: 5000,
      words: spoken('Jane Doe, the chief financial officer.', 300, 500),
      intent: 'Jane Doe is the chief financial officer.',
    },
  },
  {
    id: 'chapter-title',
    technique: 'chapter-title',
    description: 'a chapter number and its title, the rule drawing between them',
    source: rendercomp('src/components/chapter-title/ChapterTitle.tsx'),
    slot: {
      durationMs: 5000,
      words: spoken('Chapter three. The missing billion.', 300, 500),
      intent: 'Chapter three: the missing billion.',
    },
  },
  {
    id: 'logo-reveal',
    technique: 'logo-reveal',
    description: 'a mark revealed from a split, its name settling beneath it',
    source: rendercomp('src/components/logo-split-reveal/LogoSplitReveal.tsx'),
    slot: {
      durationMs: 5000,
      words: spoken('Acme was the name on every door.', 300, 500),
      intent: 'Acme was the name on every door.',
    },
  },
  {
    id: 'split-screen',
    technique: 'split-screen',
    description: 'two halves of the frame, one claim each, the divider drawn between them',
    source: rve('templates/split-screen.tsx'),
    slot: {
      durationMs: 6000,
      words: spoken('What they said, against what they did.', 300, 500),
      intent: 'What they said against what they did.',
    },
  },
]
