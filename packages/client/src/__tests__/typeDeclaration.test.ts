import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, test } from 'vitest'

describe('runtime .d.ts files', () => {
  const runtimeDir = path.resolve(__dirname, '..', '..', 'runtime')
  const dtsFiles = fs.readdirSync(runtimeDir).filter((fileName) => fileName.endsWith('.d.ts'))

  for (const file of dtsFiles) {
    test(`${file} does not depend on 'node' types`, () => {
      const dtsContents = fs.readFileSync(path.join(runtimeDir, file), 'utf8')
      expect(dtsContents).not.toContain('/// <reference types="node" />')
    })
  }
})
