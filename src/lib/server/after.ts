import { waitUntil } from '@vercel/functions'

/**
 * Runs `task` after the response has been sent, without letting the serverless function be frozen
 * mid-flight. A route that fires a push or a cleanup and then returns would otherwise have it cut
 * off the instant the response goes out. Next 14 has no `after()`, so this uses Vercel's
 * `waitUntil`; anywhere else (local dev, tests) the task simply runs in the background.
 *
 * Never throws: the work is best-effort by definition, and a failure here must not fail the request.
 */
export function afterResponse(task: () => Promise<unknown>): void {
  const run = () => task().catch((err) => console.error('after-response task failed:', err instanceof Error ? err.message : err))
  try {
    waitUntil(run())
  } catch {
    void run()
  }
}
