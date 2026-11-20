import { HrTime } from '@opentelemetry/api'
import { Temporal } from 'temporal-polyfill'

export function instantToHrTime(instant: Temporal.Instant): HrTime {
  const epochSeconds = Math.trunc(instant.epochMilliseconds / 1000)

  const partialNanoseconds = instant.epochNanoseconds - BigInt(epochSeconds) * 1_000_000_000n

  return [epochSeconds, Number(partialNanoseconds)]
}
