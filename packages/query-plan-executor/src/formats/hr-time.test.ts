import { Temporal } from 'temporal-polyfill'
import { describe, expect, it } from 'vitest'

import { instantToHrTime } from './hr-time'

describe('instantToHrTime', () => {
  it('converts instant to HrTime array', () => {
    const instant = Temporal.Instant.from('2023-05-20T12:34:56.789123456Z')
    const hrTime = instantToHrTime(instant)

    // 2023-05-20T12:34:56Z seconds since epoch
    expect(hrTime[0]).toEqual(1684586096)
    // The nanosecond portion (789123456)
    expect(hrTime[1]).toEqual(789123456)
  })

  it('handles zero nanoseconds correctly', () => {
    const instant = Temporal.Instant.from('2023-05-20T12:34:56Z')
    const hrTime = instantToHrTime(instant)

    expect(hrTime[0]).toEqual(1684586096)
    expect(hrTime[1]).toEqual(0)
  })
})
