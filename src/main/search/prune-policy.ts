/** Default max number of indexed segments before oldest are pruned. */
export const SEGMENT_CAP = 50000

/** How many oldest rows to delete to bring `count` back to `cap` (0 when within cap). */
export function overage(count: number, cap: number): number {
  return Math.max(0, count - cap)
}
