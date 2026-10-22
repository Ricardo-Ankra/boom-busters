/**
 * The one step tool the research code needs. An Inngest run passes its `step`
 * through `inngestSteps`; the back-test harness, which has no Inngest run
 * around it, passes `inlineSteps` and gets the same code without durability.
 */
export interface Steps {
  run<T>(id: string, fn: () => Promise<T>): Promise<T>
}

export const inlineSteps: Steps = { run: (_, fn) => fn() }

/**
 * Inngest's `step` as `Steps`. Its `run` types a result as `Jsonify<T>`, which
 * a generic `T` cannot be proved equal to, so it does not fit the interface as
 * it is. Every step the research code runs returns plain JSON (strings,
 * numbers, arrays, records; no dates, no class instances), so the value that
 * comes back is the value that went in, and the cast says so in one place.
 */
export function inngestSteps(step: {
  run: (id: string, fn: () => Promise<unknown>) => Promise<unknown>
}): Steps {
  return { run: <T>(id: string, fn: () => Promise<T>) => step.run(id, fn) as Promise<T> }
}
