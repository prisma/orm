import fs from 'node:fs'
import path from 'node:path'

import execa from 'execa'

import { isBun } from './is-bun'

/**
 * Pinned version of the `skills` CLI (https://github.com/vercel-labs/skills)
 * used to install the Prisma skills catalog, so that `prisma init` behaves
 * the same regardless of upstream releases.
 */
export const SKILLS_CLI_VERSION = '1.5.14'

/** Agents the Prisma skills catalog is installed for. */
export const SKILL_AGENTS = ['cursor', 'claude-code', 'codex', 'windsurf'] as const

/** Source of the Prisma skills catalog, as understood by the `skills` CLI. */
export const SKILLS_SOURCE = 'prisma/skills'

// The skills CLI only links into agent-specific project directories when their
// root exists, so create them before running in symlink mode.
const agentSpecificSkillsDirs = ['.claude/skills', '.windsurf/skills'] as const

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun'

/**
 * Command prefix that runs a one-off package binary with a given package
 * manager, e.g. `npx --yes` or `pnpm dlx`.
 */
export type Runner = {
  packageManager: PackageManager
  command: string
  /** Arguments that precede the package spec. */
  args: string[]
}

const runners: Record<PackageManager, Runner> = {
  // `--yes` skips npx's "Ok to proceed?" prompt, which would hang forever
  // when `prisma init` runs without a TTY.
  npm: { packageManager: 'npm', command: 'npx', args: ['--yes'] },
  pnpm: { packageManager: 'pnpm', command: 'pnpm', args: ['dlx'] },
  yarn: { packageManager: 'yarn', command: 'yarn', args: ['dlx'] },
  bun: { packageManager: 'bun', command: 'bunx', args: [] },
}

const lockfiles: [filename: string, packageManager: PackageManager][] = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
  ['package-lock.json', 'npm'],
]

export type DetectRunnerOptions = {
  /** Environment to read `npm_config_user_agent` from. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv
  /** Whether the CLI itself runs on Bun. Defaults to a runtime check. */
  isBunRuntime?: boolean
}

/**
 * Detects the package manager runner for one-off package binaries: the
 * package manager that invoked the CLI when known, Bun when running on the
 * Bun runtime, the package manager owning a lockfile in `cwd` otherwise, and
 * npm as the fallback.
 */
export function detectRunner(
  cwd: string,
  { env = process.env, isBunRuntime = isBun }: DetectRunnerOptions = {},
): Runner {
  const fromUserAgent = packageManagerFromUserAgent(env.npm_config_user_agent)
  if (fromUserAgent !== undefined) {
    return runners[fromUserAgent]
  }

  if (isBunRuntime) {
    return runners.bun
  }

  for (const [filename, packageManager] of lockfiles) {
    if (fs.existsSync(path.join(cwd, filename))) {
      return runners[packageManager]
    }
  }

  return runners.npm
}

function packageManagerFromUserAgent(userAgent: string | undefined): PackageManager | undefined {
  const [name, version] = userAgent?.split(' ')[0]?.split('/') ?? []
  switch (name) {
    case 'npm':
    case 'pnpm':
    case 'bun':
      return name
    case 'yarn':
      // Yarn 1 (classic) has no `dlx` command, so one-off binaries run
      // through npx instead.
      return Number(version?.split('.')[0]) === 1 ? 'npm' : 'yarn'
    default:
      return undefined
  }
}

export function installArgs(runner: Runner): string[] {
  return [
    ...runner.args,
    `skills@${SKILLS_CLI_VERSION}`,
    'add',
    SKILLS_SOURCE,
    '--agent',
    ...SKILL_AGENTS,
    '--skill',
    '*',
    '-y',
  ]
}

function prepareAgentSpecificSkillsDirs(cwd: string) {
  for (const skillsDir of agentSpecificSkillsDirs) {
    fs.mkdirSync(path.join(cwd, skillsDir), { recursive: true })
  }
}

function shellQuote(arg: string): string {
  return /^[\w@/.=-]+$/.test(arg) ? arg : `'${arg}'`
}

function buildManualCommand(runner: Runner): string {
  return [runner.command, ...installArgs(runner)].map(shellQuote).join(' ')
}

/**
 * The shell command that installs the Prisma skills into the project at
 * `cwd`, using the same runner detection as {@link installSkills}.
 */
export function manualInstallCommand(cwd: string, options: DetectRunnerOptions = {}): string {
  return buildManualCommand(detectRunner(cwd, options))
}

export type ExecFn = (command: string, args: string[], options: { cwd: string }) => Promise<unknown>

// A hung installer (e.g. a stalled network call) must not hang `prisma init`
// itself: the killed process rejects, which resolves into the non-fatal
// failure shape with the manual command.
const defaultExec: ExecFn = (command, args, { cwd }) => execa(command, args, { cwd, stdio: 'ignore', timeout: 60_000 })

export type InstallSkillsOptions = DetectRunnerOptions & {
  cwd: string
  /** Executes the runner command; defaults to execa with subprocess output hidden. */
  exec?: ExecFn
}

export type InstallSkillsResult = { ok: true } | { ok: false; manualCommand: string }

/**
 * Installs the Prisma skills catalog for the supported agents via the
 * `skills` CLI, hiding the CLI's output from the parent process. Never
 * throws: a failed install resolves to `{ ok: false, manualCommand }`, where
 * `manualCommand` is the equivalent shell command to run by hand.
 */
export async function installSkills({
  cwd,
  exec = defaultExec,
  ...detectOptions
}: InstallSkillsOptions): Promise<InstallSkillsResult> {
  let runner = runners.npm
  try {
    runner = detectRunner(cwd, detectOptions)
    prepareAgentSpecificSkillsDirs(cwd)
    await exec(runner.command, installArgs(runner), { cwd })
    return { ok: true }
  } catch {
    return { ok: false, manualCommand: buildManualCommand(runner) }
  }
}
