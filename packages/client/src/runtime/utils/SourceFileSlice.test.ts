import { SourceFileSlice } from './SourceFileSlice'

test('line numbers', () => {
  const slice = SourceFileSlice.fromContent('1\n2\n3')
  expect(slice.firstLineNumber).toBe(1)
  expect(slice.lastLineNumber).toBe(3)
})

test('toString', () => {
  const slice = SourceFileSlice.fromContent('1\n2\n3')
  expect(slice.toString()).toBe('1\n2\n3')
})

test('toString with CRLF line endings', () => {
  const slice = SourceFileSlice.fromContent('1\r\n2\r\n3')
  expect(slice.toString()).toBe('1\n2\n3')
})

test('sliced line numbers', () => {
  const slice = SourceFileSlice.fromContent('1\n2\n3\n4\n5').slice(2, 3)
  expect(slice.firstLineNumber).toBe(2)
  expect(slice.lastLineNumber).toBe(3)
})

test('sliced toString', () => {
  const slice = SourceFileSlice.fromContent('1\n2\n3\n4\n5').slice(2, 3)
  expect(slice.toString()).toBe('2\n3')
})

test('sliced toString after slice', () => {
  const slice = SourceFileSlice.fromContent('1\n2\n3\n4\n5').slice(2, 4).slice(3, 4)
  expect(slice.toString()).toBe('3\n4')
})

test('slice clamps lower bound after slice', () => {
  const slice = SourceFileSlice.fromContent('1\n2\n3\n4\n5').slice(2, 4).slice(1, 3)
  expect(slice.firstLineNumber).toBe(2)
  expect(slice.toString()).toBe('2\n3')
})

test('slice clamps upper bound after slice', () => {
  const slice = SourceFileSlice.fromContent('1\n2\n3\n4\n5').slice(2, 4).slice(3, 5)
  expect(slice.firstLineNumber).toBe(3)
  expect(slice.toString()).toBe('3\n4')
})

test('lineAt', () => {
  const slice = SourceFileSlice.fromContent('1\n2\n3')
  expect(slice.lineAt(2)).toBe('2')
})

test('lineAt outside of range', () => {
  const slice = SourceFileSlice.fromContent('1\n2\n3')
  expect(slice.lineAt(10)).toBeUndefined()
})

test('lineAt after slice', () => {
  const slice = SourceFileSlice.fromContent('1\n2\n3\n4\n5').slice(2, 3)
  expect(slice.lineAt(2)).toBe('2')
})

test('lineAt after slice outside of range', () => {
  const slice = SourceFileSlice.fromContent('1\n2\n3\n4\n5').slice(2, 3)
  expect(slice.lineAt(10)).toBeUndefined()
})

test('mapLineAt', () => {
  const slice = SourceFileSlice.fromContent('1\n2\n3').mapLineAt(2, (line) => `mapped ${line}`)
  expect(slice.toString()).toBe('1\nmapped 2\n3')
})

test('mapLineAt outside of range', () => {
  let called = false
  const slice = SourceFileSlice.fromContent('1\n2\n3')
  const mapped = slice.mapLineAt(4, () => {
    called = true
    return 'mapped'
  })

  expect(mapped).toBe(slice)
  expect(called).toBe(false)
})

test('mapLines', () => {
  const slice = SourceFileSlice.fromContent('one\ntwo\nthree').mapLines((line, number) => `line ${number}: ${line}`)
  expect(slice.toString()).toMatchInlineSnapshot(`
    "line 1: one
    line 2: two
    line 3: three"
  `)
})

test('mapLines after slice', () => {
  const slice = SourceFileSlice.fromContent('one\ntwo\nthree\nfour\nfive')
    .slice(2, 4)
    .mapLines((line, number) => `line ${number}: ${line}`)
  expect(slice.toString()).toMatchInlineSnapshot(`
    "line 2: two
    line 3: three
    line 4: four"
  `)
})

test('prependSymbolAt', () => {
  const slice = SourceFileSlice.fromContent('one\ntwo\nthree').prependSymbolAt(2, '>')
  expect(slice.lineAt(1)).toBe('  one')
  expect(slice.lineAt(2)).toBe('> two')
  expect(slice.lineAt(3)).toBe('  three')
})
