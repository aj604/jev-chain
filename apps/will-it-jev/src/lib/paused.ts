/**
 * The site's off switch. Set `PAUSED` to any non-empty value (after
 * trimming) and the Jev proxy answers 503 before it reaches a provider. The
 * decompose endpoint reads the same rule.
 */
export function isPaused(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.PAUSED?.trim());
}
