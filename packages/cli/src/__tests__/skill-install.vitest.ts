import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'

import type { Runner } from '../init/skill-install'
import { detectRunner, installArgs, installSkills, SKILLS_CLI_VERSION, SKILLS_SOURCE } from '../init/skill-install'

const tmpDirs: string[] = []

function makeTmpDir(files: string[] = []): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-install-test-'))
  tmpDirs.push(dir)
  for (const file of files) {
    fs.writeFileSync(path.join(dir, file), '')
  }
  return dir
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

type ExecCall = { command: string; args: string[]; cwd: string }

function recordingExec(result: () => Promise<unknown> = () => Promise.resolve()) {
  const calls: ExecCall[] = []
  const exec = (command: string, args: string[], options: { cwd: string }) => {
    calls.push({ command, args, cwd: options.cwd })
    return result()
  }
  return { calls, exec }
}

describe('command assembly', () => {
  test('npm', async () => {
    const cwd = makeTmpDir()
    const { calls, exec } = recordingExec()
    const runner: Runner = { packageManager: 'npm', command: 'npx', args: ['--yes'] }

    const result = await installSkills({
      cwd,
      env: { npm_config_user_agent: 'npm/10.9.0 node/v22.12.0 linux x64' },
      isBunRuntime: false,
      exec,
    })

    expect(result).toEqual({ ok: true })
    expect(calls).toEqual([{ command: runner.command, args: installArgs(runner), cwd }])
  })

  test('pnpm', async () => {
    const cwd = makeTmpDir()
    const { calls, exec } = recordingExec()
    const runner: Runner = { packageManager: 'pnpm', command: 'pnpm', args: ['dlx'] }

    const result = await installSkills({
      cwd,
      env: { npm_config_user_agent: 'pnpm/10.15.1 npm/? node/v22.12.0 linux x64' },
      isBunRuntime: false,
      exec,
    })

    expect(result).toEqual({ ok: true })
    expect(calls).toEqual([{ command: runner.command, args: installArgs(runner), cwd }])
  })

  test('yarn 2+', async () => {
    const cwd = makeTmpDir()
    const { calls, exec } = recordingExec()
    const runner: Runner = { packageManager: 'yarn', command: 'yarn', args: ['dlx'] }

    const result = await installSkills({
      cwd,
      env: { npm_config_user_agent: 'yarn/4.5.0 npm/? node/v22.12.0 linux x64' },
      isBunRuntime: false,
      exec,
    })

    expect(result).toEqual({ ok: true })
    expect(calls).toEqual([{ command: runner.command, args: installArgs(runner), cwd }])
  })

  test('yarn 1 routes through npx', async () => {
    const cwd = makeTmpDir()
    const { calls, exec } = recordingExec()
    const runner: Runner = { packageManager: 'npm', command: 'npx', args: ['--yes'] }

    const result = await installSkills({
      cwd,
      env: { npm_config_user_agent: 'yarn/1.22.22 npm/? node/v22.12.0 linux x64' },
      isBunRuntime: false,
      exec,
    })

    expect(result).toEqual({ ok: true })
    expect(calls).toEqual([{ command: runner.command, args: installArgs(runner), cwd }])
  })

  test('bun via runtime check', async () => {
    const cwd = makeTmpDir()
    const { calls, exec } = recordingExec()
    const runner: Runner = { packageManager: 'bun', command: 'bunx', args: [] }

    const result = await installSkills({ cwd, env: {}, isBunRuntime: true, exec })

    expect(result).toEqual({ ok: true })
    expect(calls).toEqual([{ command: runner.command, args: installArgs(runner), cwd }])
  })

  test('creates agent-specific skills directories before running the skills CLI', async () => {
    const cwd = makeTmpDir()
    const exec = () => {
      expect(fs.existsSync(path.join(cwd, '.claude/skills'))).toBe(true)
      expect(fs.existsSync(path.join(cwd, '.windsurf/skills'))).toBe(true)
      return Promise.resolve()
    }

    const result = await installSkills({ cwd, env: {}, isBunRuntime: false, exec })

    expect(result).toEqual({ ok: true })
  })
})

describe('runner detection', () => {
  test('falls back to npm in a directory without package.json or lockfiles', () => {
    const cwd = makeTmpDir()

    const runner = detectRunner(cwd, { env: {}, isBunRuntime: false })

    expect(runner).toEqual({ packageManager: 'npm', command: 'npx', args: ['--yes'] })
  })

  test.each([
    ['pnpm-lock.yaml', 'pnpm'],
    ['yarn.lock', 'yarn'],
    ['bun.lock', 'bun'],
    ['bun.lockb', 'bun'],
    ['package-lock.json', 'npm'],
  ])('detects %s as %s', (lockfile, packageManager) => {
    const cwd = makeTmpDir(['package.json', lockfile])

    const runner = detectRunner(cwd, { env: {}, isBunRuntime: false })

    expect(runner.packageManager).toBe(packageManager)
  })

  test('npm_config_user_agent takes precedence over lockfiles', () => {
    const cwd = makeTmpDir(['package.json', 'pnpm-lock.yaml'])

    const runner = detectRunner(cwd, {
      env: { npm_config_user_agent: 'yarn/4.5.0 npm/? node/v22.12.0 linux x64' },
      isBunRuntime: false,
    })

    expect(runner.packageManager).toBe('yarn')
  })

  test('routes a yarn 1 user agent to npm because classic yarn has no dlx', () => {
    const cwd = makeTmpDir(['package.json', 'yarn.lock'])

    const runner = detectRunner(cwd, {
      env: { npm_config_user_agent: 'yarn/1.22.22 npm/? node/v22.12.0 linux x64' },
      isBunRuntime: false,
    })

    expect(runner.packageManager).toBe('npm')
  })

  test('ignores unrecognized npm_config_user_agent', () => {
    const cwd = makeTmpDir(['package.json', 'pnpm-lock.yaml'])

    const runner = detectRunner(cwd, {
      env: { npm_config_user_agent: 'deno/2.0.0' },
      isBunRuntime: false,
    })

    expect(runner.packageManager).toBe('pnpm')
  })
})

describe('failure handling', () => {
  test('resolves to the failure shape with a manual command instead of throwing', async () => {
    const cwd = makeTmpDir()
    const { exec } = recordingExec(() => Promise.reject(new Error('spawn npx ENOENT')))

    const result = await installSkills({ cwd, env: {}, isBunRuntime: false, exec })

    expect(result).toEqual({
      ok: false,
      manualCommand: `npx --yes skills@${SKILLS_CLI_VERSION} add ${SKILLS_SOURCE} --agent cursor claude-code codex windsurf --skill '*' -y`,
    })
  })

  test('manual command matches the detected runner', async () => {
    const cwd = makeTmpDir()
    const { exec } = recordingExec(() => Promise.reject(new Error('exit code 1')))

    const result = await installSkills({
      cwd,
      env: { npm_config_user_agent: 'pnpm/10.15.1 npm/? node/v22.12.0 linux x64' },
      isBunRuntime: false,
      exec,
    })

    expect(result).toEqual({
      ok: false,
      manualCommand: `pnpm dlx skills@${SKILLS_CLI_VERSION} add ${SKILLS_SOURCE} --agent cursor claude-code codex windsurf --skill '*' -y`,
    })
  })

  test('manual command for a yarn 1 user agent uses npx', async () => {
    const cwd = makeTmpDir()
    const { exec } = recordingExec(() => Promise.reject(new Error('exit code 1')))

    const result = await installSkills({
      cwd,
      env: { npm_config_user_agent: 'yarn/1.22.22 npm/? node/v22.12.0 linux x64' },
      isBunRuntime: false,
      exec,
    })

    expect(result).toEqual({
      ok: false,
      manualCommand: `npx --yes skills@${SKILLS_CLI_VERSION} add ${SKILLS_SOURCE} --agent cursor claude-code codex windsurf --skill '*' -y`,
    })
  })
})
