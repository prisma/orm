import readline from 'node:readline'
import { Readable } from 'node:stream'

import { describe, expect, test } from 'vitest'

/**
 * Verify node:readline correctly handles multibyte UTF-8 characters split across chunks.
 *
 * This is a regression test for https://github.com/prisma/prisma/issues/27695
 *
 * Note: Integration tests can't reliably reproduce chunk splitting, so these unit tests
 * directly control chunk boundaries.
 */

/**
 * Helper function to collect lines from a readline interface
 */
async function collectLines(stream: Readable): Promise<string[]> {
  const rl = readline.createInterface({
    input: stream,
    crlfDelay: Infinity,
  })

  const lines: string[] = []
  rl.on('line', (line) => lines.push(line))

  return new Promise((resolve) => {
    rl.on('close', () => resolve(lines))
  })
}

/**
 * Helper function to create a readable stream from chunks
 */
function createStreamFromChunks(chunks: Buffer[]): Readable {
  let index = 0
  return new Readable({
    read() {
      if (index < chunks.length) {
        this.push(chunks[index])
        index++
      } else {
        this.push(null)
      }
    },
  })
}

describe('readline multibyte UTF-8 handling', () => {
  test('handles single Japanese character (3 bytes) split across chunks', async () => {
    // 「あ」is UTF-8 encoded as [0xE3, 0x81, 0x82]
    const chunk1 = Buffer.from([0xe3, 0x81]) // First 2 bytes
    const chunk2 = Buffer.from([0x82, 0x0a]) // Last byte + newline

    const stream = createStreamFromChunks([chunk1, chunk2])
    const lines = await collectLines(stream)

    expect(lines).toEqual(['あ'])
  })

  test('handles multiple lines with multibyte characters split across chunks', async () => {
    // Multiple lines: "日本語\n😀" (no trailing newline)
    // 日: [0xE6, 0x97, 0xA5]
    // 本: [0xE6, 0x9C, 0xAC]
    // 語: [0xE8, 0xAA, 0x9E]
    // 😀: [0xF0, 0x9F, 0x98, 0x80]
    const line1 = Buffer.from('日本語\n', 'utf8')
    const line2 = Buffer.from('😀', 'utf8') // No newline at end
    const fullBuffer = Buffer.concat([line1, line2])

    // Split in the middle of the second line (within the emoji)
    const splitPoint = line1.length + 2 // Split after first 2 bytes of emoji
    const chunk1 = fullBuffer.subarray(0, splitPoint)
    const chunk2 = fullBuffer.subarray(splitPoint)

    const stream = createStreamFromChunks([chunk1, chunk2])
    const lines = await collectLines(stream)

    expect(lines).toEqual(['日本語', '😀'])
  })
})
