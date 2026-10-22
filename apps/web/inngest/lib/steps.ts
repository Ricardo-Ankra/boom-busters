/**
 * The one step tool the research code needs. Inngest's `step` satisfies it as
 * it is; the back-test harness, which has no Inngest run around it, passes
 * `inlineSteps` and gets the same code without durability.
 */
export interface Steps {
  run<T>(id: string, fn: () => Promise<T>): Promise<T>
}

export const inlineSteps: Steps = { run: (_, fn) => fn() }
