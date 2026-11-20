export type EngineTimestamp = [seconds: number, nanoseconds: number]

/**
 * Converts engine timestamp to JS timestamp, as accepted by `Date` constructor
 */
export function convertEngineTimestamp(timestamp: EngineTimestamp): number {
  return timestamp[0] * 1e3 + timestamp[1] / 1e6
}

/**
 * Parses a `Date` from engine timestamp
 */
export function dateFromEngineTimestamp(timestamp: EngineTimestamp): Date {
  return new Date(convertEngineTimestamp(timestamp))
}
