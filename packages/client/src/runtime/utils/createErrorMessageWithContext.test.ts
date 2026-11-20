import { fs, vol } from 'memfs'
import { performance } from 'perf_hooks'

import { CallSite } from './CallSite'
import { createErrorMessageWithContext } from './createErrorMessageWithContext'

jest.mock('fs', () => fs)

function mockCallsite(fileName: string, lineNumber: number | null, columnNumber: number | null): CallSite {
  return {
    getLocation() {
      return { fileName, lineNumber, columnNumber }
    },
  }
}

function mockFile(mockedPath: string, content: string) {
  vol.fromJSON({
    [mockedPath]: content,
  })
}

beforeAll(() => {
  ;(globalThis as any).TARGET_BUILD_TYPE = 'client'
})

afterAll(() => {
  delete (globalThis as any).TARGET_BUILD_TYPE
})

afterEach(() => vol.reset())

test('basic', () => {
  expect(
    createErrorMessageWithContext({
      originalMethod: 'model.findFirst',
      callsite: mockCallsite('/project/some-file.js', 12, 34),
      message: 'What a terrible failure!',
    }),
  ).toMatchInlineSnapshot(`
    "
    Invalid \`prisma.model.findFirst()\` invocation:


    What a terrible failure!"
  `)
})

test('basic panic', () => {
  expect(
    createErrorMessageWithContext({
      originalMethod: 'model.findFirst',
      callsite: mockCallsite('/project/some-file.js', 12, 34),
      isPanic: true,
      message: 'What a terrible failure!',
    }),
  ).toMatchInlineSnapshot(`
    "
    Oops, an unknown error occurred! This is on us, you did nothing wrong.
    It occurred in the \`prisma.model.findFirst()\` invocation:


    What a terrible failure!"
  `)
})

test('without callsite', () => {
  expect(
    createErrorMessageWithContext({
      originalMethod: 'model.findFirst',
      message: 'What a terrible failure!',
    }),
  ).toMatchInlineSnapshot(`
    "
    Invalid \`prisma.model.findFirst()\` invocation:


    What a terrible failure!"
  `)
})

test('with matching source file', () => {
  mockFile('/project/some-file.js', 'prisma.model.findFirst({})')
  expect(
    createErrorMessageWithContext({
      originalMethod: 'model.findFirst',
      callsite: mockCallsite('/project/some-file.js', 1, 1),
      message: 'What a terrible failure!',
    }),
  ).toMatchInlineSnapshot(`
    "
    Invalid \`prisma.model.findFirst()\` invocation in
    /project/some-file.js:1:1

    → 1 prisma.model.findFirst(
    What a terrible failure!"
  `)
})

test('panic with matching source file', () => {
  mockFile('/project/some-file.js', 'prisma.model.findFirst({})')
  expect(
    createErrorMessageWithContext({
      originalMethod: 'model.findFirst',
      callsite: mockCallsite('/project/some-file.js', 1, 1),
      isPanic: true,
      message: 'What a terrible failure!',
    }),
  ).toMatchInlineSnapshot(`
    "
    Oops, an unknown error occurred! This is on us, you did nothing wrong.
    It occurred in the \`prisma.model.findFirst()\` invocation in
    /project/some-file.js:1:1

    → 1 prisma.model.findFirst({})
    What a terrible failure!"
  `)
})

test('with matching source file, but without matching call at the line', () => {
  mockFile('/project/some-file.js', 'somethingDifferent()')
  expect(
    createErrorMessageWithContext({
      originalMethod: 'model.findFirst',
      callsite: mockCallsite('/project/some-file.js', 1, 1),
      message: 'What a terrible failure!',
    }),
  ).toMatchInlineSnapshot(`
    "
    Invalid \`prisma.model.findFirst()\` invocation:


    What a terrible failure!"
  `)
})

test('with matching source file, but non-existing line number', () => {
  mockFile('/project/some-file.js', 'someCode()')
  expect(
    createErrorMessageWithContext({
      originalMethod: 'model.findFirst',
      callsite: mockCallsite('/project/some-file.js', 10, 1),
      message: 'What a terrible failure!',
    }),
  ).toMatchInlineSnapshot(`
    "
    Invalid \`prisma.model.findFirst()\` invocation:


    What a terrible failure!"
  `)
})

test('with matching source line, but without {', () => {
  mockFile('/project/some-file.js', 'prisma.model.findFirst(getParameters())')
  expect(
    createErrorMessageWithContext({
      originalMethod: 'model.findFirst',
      callsite: mockCallsite('/project/some-file.js', 1, 1),
      message: 'What a terrible failure!',
    }),
  ).toMatchInlineSnapshot(`
    "
    Invalid \`prisma.model.findFirst()\` invocation in
    /project/some-file.js:1:1

    → 1 prisma.model.findFirst(
    What a terrible failure!"
  `)
})

test('with matching source line, wrapped', () => {
  mockFile('/project/some-file.js', 'wrap(prisma.model.findFirst(getParameters())).doSomething()')
  expect(
    createErrorMessageWithContext({
      originalMethod: 'model.findFirst',
      callsite: mockCallsite('/project/some-file.js', 1, 1),
      message: 'What a terrible failure!',
    }),
  ).toMatchInlineSnapshot(`
    "
    Invalid \`wrap(prisma.model.findFirst()\` invocation in
    /project/some-file.js:1:1

    → 1 wrap(prisma.model.findFirst(
    What a terrible failure!"
  `)
})

test('with indentation in source file', () => {
  mockFile('/project/some-file.js', '    prisma.model.findFirst({})')
  expect(
    createErrorMessageWithContext({
      originalMethod: 'model.findFirst',
      callsite: mockCallsite('/project/some-file.js', 1, 1),
      message: 'What a terrible failure!',
    }),
  ).toMatchInlineSnapshot(`
    "
    Invalid \`prisma.model.findFirst()\` invocation in
    /project/some-file.js:1:1

    → 1 prisma.model.findFirst(
    What a terrible failure!"
  `)
})

test('with different prisma variable name', () => {
  mockFile('/project/some-file.js', 'this.db.model.findFirst({})')
  expect(
    createErrorMessageWithContext({
      originalMethod: 'model.findFirst',
      callsite: mockCallsite('/project/some-file.js', 1, 1),
      message: 'What a terrible failure!',
    }),
  ).toMatchInlineSnapshot(`
    "
    Invalid \`this.db.model.findFirst()\` invocation in
    /project/some-file.js:1:1

    → 1 this.db.model.findFirst(
    What a terrible failure!"
  `)
})

test('with context lines before', () => {
  mockFile(
    '/project/some-file.js',
    `lineOne();
lineTwo();
lineThree();
lineFour();
prisma.model.findFirst({
})
`,
  )
  expect(
    createErrorMessageWithContext({
      originalMethod: 'model.findFirst',
      callsite: mockCallsite('/project/some-file.js', 5, 1),
      message: 'What a terrible failure!',
    }),
  ).toMatchInlineSnapshot(`
    "
    Invalid \`prisma.model.findFirst()\` invocation in
    /project/some-file.js:5:1

      2 lineTwo();
      3 lineThree();
      4 lineFour();
    → 5 prisma.model.findFirst(
    What a terrible failure!"
  `)
})

test('with double-digit context line numbers', () => {
  mockFile(
    '/project/some-file.js',
    `one();
two();
three();
four();
five();
six();
seven();
eight();
nine();
prisma.model.findFirst({
})
`,
  )
  expect(
    createErrorMessageWithContext({
      originalMethod: 'model.findFirst',
      callsite: mockCallsite('/project/some-file.js', 10, 1),
      message: 'What a terrible failure!',
    }),
  ).toMatchInlineSnapshot(`
    "
    Invalid \`prisma.model.findFirst()\` invocation in
    /project/some-file.js:10:1

       7 seven();
       8 eight();
       9 nine();
    → 10 prisma.model.findFirst(
    What a terrible failure!"
  `)
})

test('with context and indentation', () => {
  mockFile(
    '/project/some-file.js',
    `
if (someCondition) {
    prima.model.findFirst({})
}
`,
  )
  expect(
    createErrorMessageWithContext({
      originalMethod: 'model.findFirst',
      callsite: mockCallsite('/project/some-file.js', 3, 1),
      message: 'What a terrible failure!',
    }),
  ).toMatchInlineSnapshot(`
    "
    Invalid \`prima.model.findFirst()\` invocation in
    /project/some-file.js:3:1

      1 
      2 if (someCondition) {
    → 3     prima.model.findFirst(
    What a terrible failure!"
  `)
})

test('with arguments', () => {
  mockFile('/project/some-file.js', 'prisma.model.findFirst({})')
  expect(
    createErrorMessageWithContext({
      originalMethod: 'model.findFirst',
      callArguments: '{foo: "bar"}',
      callsite: mockCallsite('/project/some-file.js', 1, 1),
      message: 'What a terrible failure!',
    }),
  ).toMatchInlineSnapshot(`
    "
    Invalid \`prisma.model.findFirst()\` invocation in
    /project/some-file.js:1:1

    → 1 prisma.model.findFirst({foo: "bar"})

    What a terrible failure!"
  `)
})

test('with arguments, but with no matching invocation', () => {
  expect(
    createErrorMessageWithContext({
      originalMethod: 'model.findFirst',
      callArguments: '{foo: "bar"}',
      callsite: mockCallsite('/project/some-file.js', 1, 1),
      message: 'What a terrible failure!',
    }),
  ).toMatchInlineSnapshot(`
    "
    Invalid \`prisma.model.findFirst()\` invocation:

    {foo: "bar"}

    What a terrible failure!"
  `)
})

test('with multiline arguments', () => {
  mockFile('/project/some-file.js', 'prisma.model.findFirst({})')
  expect(
    createErrorMessageWithContext({
      originalMethod: 'model.findFirst',
      callArguments: `{
  foo: "bar"
}`,
      callsite: mockCallsite('/project/some-file.js', 1, 1),
      message: 'What a terrible failure!',
    }),
  ).toMatchInlineSnapshot(`
    "
    Invalid \`prisma.model.findFirst()\` invocation in
    /project/some-file.js:1:1

    → 1 prisma.model.findFirst({
          foo: "bar"
        })

    What a terrible failure!"
  `)
})

test('with indentation and multiline arguments', () => {
  mockFile(
    '/project/some-file.js',
    `
if (condition) {
  prisma.model.findFirst({})
}
`,
  )
  expect(
    createErrorMessageWithContext({
      originalMethod: 'model.findFirst',
      callArguments: `{
  foo: "bar"
}`,
      callsite: mockCallsite('/project/some-file.js', 3, 1),
      message: 'What a terrible failure!',
    }),
  ).toMatchInlineSnapshot(`
    "
    Invalid \`prisma.model.findFirst()\` invocation in
    /project/some-file.js:3:1

      1 
      2 if (condition) {
    → 3   prisma.model.findFirst({
            foo: "bar"
          })

    What a terrible failure!"
  `)
})

test('with windows lines endings', () => {
  mockFile(
    'C:/project/some-file.js',
    'lineOne();\r\nlineTwo();\r\nlineThree();\r\nprisma.model.findFirst({})\r\nlineFive()',
  )
  expect(
    createErrorMessageWithContext({
      originalMethod: 'model.findFirst',
      callsite: mockCallsite('C:/project/some-file.js', 4, 1),
      message: 'What a terrible failure!',
    }),
  ).toMatchInlineSnapshot(`
    "
    Invalid \`prisma.model.findFirst()\` invocation in
    C:/project/some-file.js:4:1

      1 lineOne();
      2 lineTwo();
      3 lineThree();
    → 4 prisma.model.findFirst(
    What a terrible failure!"
  `)
})

test('does not uses polynominal regex', () => {
  // from https://devina.io/redos-checker
  const example = 'tfindFirs'.repeat(18258) + 's'

  mockFile('/project/some-file.js', example)

  // sync timeouts don't work in jest (https://github.com/facebook/jest/issues/6947), so we have to improvise
  const start = performance.now()

  createErrorMessageWithContext({
    originalMethod: 'model.findFirst',
    callsite: mockCallsite('/project/some-file.js', 1, 1),
    message: 'What a terrible failure!',
  })
  const timeTook = performance.now() - start

  expect(timeTook).toBeLessThan(100)
})
