import { expect, test } from 'vitest'

import { GeneratorRegistry } from './generators'

test('should always return the same time for a single snapshot', async () => {
  const registry = new GeneratorRegistry()
  const snapshot = registry.snapshot()
  const time1 = snapshot.now.generate()
  await new Promise((resolve) => setTimeout(resolve, 10))
  const time2 = snapshot.now.generate()

  expect(time1).toBe(time2)
})

test('should return different times for different snapshots', async () => {
  const registry = new GeneratorRegistry()
  const time1 = registry.snapshot().now.generate()
  await new Promise((resolve) => setTimeout(resolve, 10))
  const time2 = registry.snapshot().now.generate()

  expect(time1).not.toBe(time2)
})

test('should generate different and valid v4 UUIDs', () => {
  const registry = new GeneratorRegistry()
  const snapshot = registry.snapshot()

  const uuid1 = snapshot.uuid.generate(4)
  const uuid2 = snapshot.uuid.generate(4)
  expect(uuid1).not.toBe(uuid2)

  // example: decd71da-e6e7-4cd0-b043-97bd1d499b5e
  expect(uuid1).toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/)
})

test('should generate different and valid v7 UUIDs', () => {
  const registry = new GeneratorRegistry()
  const snapshot = registry.snapshot()

  const uuid1 = snapshot.uuid.generate(7)
  const uuid2 = snapshot.uuid.generate(7)
  expect(uuid1).not.toBe(uuid2)

  // example: 0195d299-416c-7142-acf0-043bcde76e1a
  expect(uuid1).toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/)
})

test('should generate different and valid ULIDs', () => {
  const registry = new GeneratorRegistry()
  const snapshot = registry.snapshot()

  const ulid1 = snapshot.ulid.generate()
  const ulid2 = snapshot.ulid.generate()
  expect(ulid1).not.toBe(ulid2)

  // example: 01JQ99JGBCRFBB2BTV6ADYCKPW
  expect(ulid1).toMatch(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/)
})

test('should generate different and valid v1 CUIDs', () => {
  const registry = new GeneratorRegistry()
  const snapshot = registry.snapshot()

  const cuid1 = snapshot.cuid.generate(1)
  const cuid2 = snapshot.cuid.generate(1)
  expect(cuid1).not.toBe(cuid2)

  // example: cm8py886j0000rhiwyy4k9d66
  expect(cuid1).toMatch(/^c[0-9a-z]{24}$/)
})

test('should generate different and valid v2 CUIDs', () => {
  const registry = new GeneratorRegistry()
  const snapshot = registry.snapshot()

  const cuid1 = snapshot.cuid.generate(2)
  const cuid2 = snapshot.cuid.generate(2)
  expect(cuid1).not.toBe(cuid2)

  // example: ppcnxushs50igf78s2y45hj2
  expect(cuid1).toMatch(/^[0-9a-z]{24}$/)
})

test('should generate different and valid Nano IDs', () => {
  const registry = new GeneratorRegistry()
  const snapshot = registry.snapshot()

  const nanoid1 = snapshot.nanoid.generate()
  const nanoid2 = snapshot.nanoid.generate()
  expect(nanoid1).not.toBe(nanoid2)

  // example: OS66Fq-h2DQ0y6frSSiky
  expect(nanoid1).toMatch(/^[A-Za-z0-9_-]{21}$/)
})

test('should generate different and valid Nano IDs with custom length', () => {
  const registry = new GeneratorRegistry()
  const snapshot = registry.snapshot()

  const nanoid1 = snapshot.nanoid.generate(7)
  const nanoid2 = snapshot.nanoid.generate(7)
  expect(nanoid1).not.toBe(nanoid2)

  // example: OS66Fq-
  expect(nanoid1).toMatch(/^[A-Za-z0-9_-]{7}$/)
})

test('should calculate correct products', () => {
  const registry = new GeneratorRegistry()
  const snapshot = registry.snapshot()

  expect(snapshot.product.generate(1, [1, 2])).toEqual([
    [1, 1],
    [1, 2],
  ])
  expect(snapshot.product.generate([1, 2], 1)).toEqual([
    [1, 1],
    [2, 1],
  ])
  expect(snapshot.product.generate(1, 2)).toEqual([[1, 2]])
})
