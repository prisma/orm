import { describe, expect, it, vi } from 'vitest'

import { ensureNeededBinariesExist } from '..'

describe('ensureNeededBinariesExist', () => {
  describe('it should download schema-engine', () => {
    describe('clientEngineType = client', () => {
      it('should not download query engine', async () => {
        const download = vi.fn()
        await ensureNeededBinariesExist({
          download,
        })
        expect(download).toHaveBeenCalledWith(
          expect.objectContaining({
            binaries: {
              'schema-engine': expect.any(String),
            },
          }),
        )
      })
    })
  })
})
