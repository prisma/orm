import path from 'node:path'

import { jestContext } from '@prisma/get-platform'

import { determineClientOutputPath } from './client-output-path'

const ctx = jestContext.new().assemble()

const defaultSchemaDir = () => path.join(process.cwd(), 'prisma')

test('empty dir', () => {
  ctx.fixture('client-output-path/empty-dir')
  const output = determineClientOutputPath(defaultSchemaDir())
  expect(output).toBe('../generated/prisma')
})

test('directory with src', () => {
  ctx.fixture('client-output-path/with-src')
  const output = determineClientOutputPath(defaultSchemaDir())
  expect(output).toBe('../src/generated/prisma')
})

test('directory with lib', () => {
  ctx.fixture('client-output-path/with-lib')
  const output = determineClientOutputPath(defaultSchemaDir())
  expect(output).toBe('../lib/generated/prisma')
})

test('directory with app', () => {
  ctx.fixture('client-output-path/with-app')
  const output = determineClientOutputPath(defaultSchemaDir())
  expect(output).toBe('../app/generated/prisma')
})

test('with rootDir in tsconfig.json', () => {
  ctx.fixture('client-output-path/with-tsconfig-rootdir')
  const output = determineClientOutputPath(defaultSchemaDir())
  expect(output).toBe('../custom-src/generated/prisma')
})

test('with baseUrl in tsconfig.json', () => {
  ctx.fixture('client-output-path/with-tsconfig-baseurl')
  const output = determineClientOutputPath(defaultSchemaDir())
  expect(output).toBe('../base-dir/generated/prisma')
})

test('with rootDirs in tsconfig.json', () => {
  ctx.fixture('client-output-path/with-tsconfig-rootdirs')
  const output = determineClientOutputPath(defaultSchemaDir())
  expect(output).toBe('../root-dir-1/generated/prisma')
})

test('with extends in tsconfig.json and no override', () => {
  ctx.fixture('client-output-path/with-tsconfig-extends-no-override')
  const output = determineClientOutputPath(defaultSchemaDir())
  expect(output).toBe('../src-base/generated/prisma')
})

test('with extends in tsconfig.json and an override', () => {
  ctx.fixture('client-output-path/with-tsconfig-extends-override')
  const output = determineClientOutputPath(defaultSchemaDir())
  expect(output).toBe('../src-override/generated/prisma')
})

test('tsconfig takes precedence over directory heuristic', () => {
  ctx.fixture('client-output-path/with-src-and-tsconfig')
  const output = determineClientOutputPath(defaultSchemaDir())
  expect(output).toBe('../src/application/generated/prisma')
})

test('non-default schema path', () => {
  ctx.fixture('client-output-path/with-src')
  const output = determineClientOutputPath(path.join(process.cwd(), 'config', 'prisma'))
  expect(output).toBe('../../src/generated/prisma')
})
