import { Temporal } from 'temporal-polyfill'

import { parseInteger } from './numeric'

/**
 * Parses a duration string into a Temporal.Duration object.
 *
 * @param duration - The duration string to parse.
 * @returns The parsed Temporal.Duration object.
 * @throws {Error} If the duration string is invalid.
 */

export function parseDuration(duration: string): Temporal.Duration {
  if (duration.startsWith('P')) {
    return Temporal.Duration.from(duration)
  }

  const milliseconds = parseInteger(duration)
  return Temporal.Duration.from({ milliseconds })
}
