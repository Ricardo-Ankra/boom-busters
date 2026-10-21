export function median(xs: number[]): number {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
}

/** 1-based ranks, with tied values sharing the average of the ranks they span. */
function averageRanks(values: number[]): number[] {
  const order = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0])
  const ranks = new Array<number>(values.length)
  let i = 0
  while (i < order.length) {
    let j = i
    while (j + 1 < order.length && order[j + 1]![0] === order[i]![0]) j++
    const avg = (i + j) / 2 + 1
    for (let k = i; k <= j; k++) ranks[order[k]![1]] = avg
    i = j + 1
  }
  return ranks
}

/** 0 to 100, ties get the average rank; a lone value ranks 100. */
export function percentileRanks(values: number[]): number[] {
  const n = values.length
  if (n === 1) return [100]
  return averageRanks(values).map((r) => (100 * (r - 1)) / (n - 1))
}

function pearson(x: number[], y: number[]): number {
  const n = x.length
  const mx = x.reduce((a, b) => a + b, 0) / n
  const my = y.reduce((a, b) => a + b, 0) / n
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (let i = 0; i < n; i++) {
    const dx = x[i]! - mx
    const dy = y[i]! - my
    sxy += dx * dy
    sxx += dx * dx
    syy += dy * dy
  }
  // A constant series has no rank order to correlate; report no association.
  if (sxx === 0 || syy === 0) return 0
  return sxy / Math.sqrt(sxx * syy)
}

/** Pearson correlation of average ranks. */
export function spearman(x: number[], y: number[]): number {
  if (x.length !== y.length) throw new Error('spearman needs equal-length series')
  if (x.length < 2) return 0
  return pearson(averageRanks(x), averageRanks(y))
}

/** Seeded PRNG so a back-test interval reproduces exactly. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Percentile bootstrap: resample pairs with replacement, take the central `level` of the statistic. */
export function bootstrapInterval(
  pairs: [number, number][],
  stat: (p: [number, number][]) => number,
  resamples: number,
  level: number,
  seed: number,
): [number, number] {
  const rand = mulberry32(seed)
  const n = pairs.length
  const draws: number[] = []
  for (let r = 0; r < resamples; r++) {
    const sample: [number, number][] = []
    for (let i = 0; i < n; i++) sample.push(pairs[Math.floor(rand() * n)]!)
    draws.push(stat(sample))
  }
  draws.sort((a, b) => a - b)
  const alpha = (1 - level) / 2
  const lo = draws[Math.floor(alpha * (draws.length - 1))]!
  const hi = draws[Math.ceil((1 - alpha) * (draws.length - 1))]!
  return [lo, hi]
}
