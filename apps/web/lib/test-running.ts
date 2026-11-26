/**
 * Whether a Test & Compare is marked running on a record (design 7.7): started
 * and not yet ended. Pure, so the server actions and the Publish card share it.
 * YouTube stops its test when the title or thumbnail changes, so every writer
 * of either refuses in these words while it is running.
 */
export function testRunningReason(record: {
  testStartedAt: Date | null
  testEndedAt: Date | null
}): string | null {
  if (record.testStartedAt && !record.testEndedAt) {
    return 'A Test & Compare is running on this video. YouTube stops the test if its title or thumbnail changes; record how it ended first.'
  }
  return null
}
