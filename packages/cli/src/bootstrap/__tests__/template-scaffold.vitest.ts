import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { detectPackageManager, isValidTemplateName } from '../template-scaffold'

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prisma-template-'))
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('isValidTemplateName', () => {
  test('accepts curated template names', () => {
    expect(isValidTemplateName('nextjs')).toBe(true)
    expect(isValidTemplateName('express')).toBe(true)
    expect(isValidTemplateName('hono')).toBe(true)
    expect(isValidTemplateName('nest')).toBe(true)
  })

  test('rejects unknown template names', () => {
    expect(isValidTemplateName('angular')).toBe(false)
    expect(isValidTemplateName('django')).toBe(false)
    expect(isValidTemplateName('')).toBe(false)
  })
})

describe('detectPackageManager', () => {
  test('detects pnpm from lockfile', () => {
    fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), '', 'utf-8')
    expect(detectPackageManager(tmpDir)).toBe('pnpm')
  })

  test('detects yarn from lockfile', () => {
    fs.writeFileSync(path.join(tmpDir, 'yarn.lock'), '', 'utf-8')
    expect(detectPackageManager(tmpDir)).toBe('yarn')
  })

  test('defaults to npm when no lockfile exists', () => {
    expect(detectPackageManager(tmpDir)).toBe('npm')
  })

  test('prefers pnpm over yarn when both exist', () => {
    fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), '', 'utf-8')
    fs.writeFileSync(path.join(tmpDir, 'yarn.lock'), '', 'utf-8')
    expect(detectPackageManager(tmpDir)).toBe('pnpm')
  })

  test('detects pnpm from packageManager field', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{"packageManager":"pnpm@10.15.1"}', 'utf-8')
    expect(detectPackageManager(tmpDir)).toBe('pnpm')
  })

  test('detects yarn from packageManager field', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{"packageManager":"yarn@4.0.0"}', 'utf-8')
    expect(detectPackageManager(tmpDir)).toBe('yarn')
  })

  test('detects bun from packageManager field', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{"packageManager":"bun@1.3.11"}', 'utf-8')
    expect(detectPackageManager(tmpDir)).toBe('bun')
  })

  test('lockfile takes priority over packageManager field', () => {
    fs.writeFileSync(path.join(tmpDir, 'yarn.lock'), '', 'utf-8')
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{"packageManager":"pnpm@10.0.0"}', 'utf-8')
    expect(detectPackageManager(tmpDir)).toBe('yarn')
  })
})
