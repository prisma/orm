import * as checkpoint from 'checkpoint-client'
import { describe, expect, test } from 'vitest'

describe('checkpointClient', () => {
  test('check async signature', async () => {
    // getSignature is used in SendPanic
    const signature = await checkpoint.getSignature()

    // Check if it's a uuid
    expect(signature).toMatch(
      /(?:^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[a-f0-9]{4}-[a-f0-9]{12}$)|(?:^0{8}-0{4}-0{4}-0{4}-0{12}$)/u,
    )
  })
})
