import Debug from '@prisma/debug'
import { isCi, isInContainer, isInNpmLifecycleHook, isInteractive, maybeInGitHook } from '@prisma/internals'
import * as checkpoint from 'checkpoint-client'
import paths from 'env-paths'
import fs from 'fs'
import { yellow } from 'kleur/colors'
import path from 'path'

import { version as cliVersion } from '../../../package.json'
import type { InstallSkillsOptions, InstallSkillsResult } from '../../init/skill-install'
import { installSkills, manualInstallCommand } from '../../init/skill-install'
import { CommandState, daysSinceFirstCommand, loadOrInitializeCommandState } from '../commandState'
import { EventCapture, PosthogEventCapture, PUBLIC_POSTHOG_NPS_PROJECT_KEY } from '../nps/capture'
import { clackPrompts, type PromptOutcome, type Prompts } from '../prompts'

const debug = Debug('prisma:cli:skills-offer')

const promptTimeoutSecs = 30

export type SkillsOfferOutcome = 'accepted' | 'declined' | 'timeout'

type SkillsOfferAcknowledgement = {
  offeredAt: string
  outcome: SkillsOfferOutcome
}

export type SkillsOfferContext = {
  /** Project directory scanned for existing skills and targeted by the install. */
  cwd: string
  /** Directory the acknowledgement file is stored in. */
  configDir: string
  isInteractive: () => boolean
  isCi: () => boolean
  maybeInGitHook: () => boolean
  isInNpmLifecycleHook: () => boolean
  isInContainer: () => boolean
  loadCommandState: () => Promise<CommandState>
  prompts: Prompts
  installSkills: (options: InstallSkillsOptions) => Promise<InstallSkillsResult>
  /** The shell command that installs the skills into a project by hand. */
  manualInstallCommand: (cwd: string) => string
  capture: EventCapture
  getSignature: () => Promise<string>
  cliVersion: string
}

function defaultContext(): SkillsOfferContext {
  return {
    cwd: process.cwd(),
    configDir: paths('prisma').config,
    isInteractive,
    isCi,
    maybeInGitHook,
    isInNpmLifecycleHook,
    isInContainer,
    loadCommandState: loadOrInitializeCommandState,
    prompts: clackPrompts,
    installSkills,
    manualInstallCommand,
    capture: new PosthogEventCapture(PUBLIC_POSTHOG_NPS_PROJECT_KEY),
    getSignature: () => checkpoint.getSignature(),
    cliVersion,
  }
}

/**
 * Offers to install the Prisma agent skills, once ever per machine, after a
 * successful generate run. Projects that already have the skills are skipped
 * silently without counting as the machine's one offer.
 *
 * Returns whether the user was actually shown a prompt, so the caller can
 * keep the number of prompts per run down to one. Never throws: any failure
 * is logged and reported as not prompted.
 */
export async function handleSkillsOffer(overrides: Partial<SkillsOfferContext> = {}): Promise<{
  prompted: boolean
}> {
  try {
    return await handleSkillsOfferImpl({ ...defaultContext(), ...overrides })
  } catch (err) {
    debug(`An error occurred while handling the skills offer: ${err}`)
    return { prompted: false }
  }
}

async function handleSkillsOfferImpl(ctx: SkillsOfferContext): Promise<{ prompted: boolean }> {
  const ackPath = path.join(ctx.configDir, 'skills-offer.json')

  if (await fileExists(ackPath)) {
    return { prompted: false }
  }

  // Detection is per project while the acknowledgement is per machine, so
  // nothing is recorded here: a project that already has the skills stays
  // silent on every run without spending the one offer other projects get.
  if (await skillsAlreadyInstalled(ctx.cwd)) {
    return { prompted: false }
  }

  if (!ctx.isInteractive() || ctx.isCi() || ctx.maybeInGitHook() || ctx.isInNpmLifecycleHook() || ctx.isInContainer()) {
    return { prompted: false }
  }

  if (daysSinceFirstCommand(await ctx.loadCommandState()) < 1) {
    return { prompted: false }
  }

  const outcome = await promptForInstall(ctx)
  await writeAcknowledgement(ackPath, outcome)

  // The offer is made once ever, so whatever happens next this is the one
  // chance to tell the user how to install the skills by hand in other
  // projects going forward.
  if (outcome === 'accepted') {
    try {
      const result = await ctx.installSkills({ cwd: ctx.cwd })
      if (result.ok) {
        ctx.prompts.message(
          'Prisma agent skills installed. To add them to another project, run this in its directory:\n' +
            `  ${ctx.manualInstallCommand(ctx.cwd)}`,
        )
      } else {
        console.warn(
          `${yellow('warn')} Failed to install Prisma agent skills. You can install them manually by running:\n  ${
            result.manualCommand
          }`,
        )
      }
    } catch (err) {
      debug(`Failed to install Prisma agent skills: ${err}`)
    }
  } else {
    try {
      ctx.prompts.message(
        "You won't be asked again. You can install the skills anytime by running this in a project's directory:\n" +
          `  ${ctx.manualInstallCommand(ctx.cwd)}`,
      )
    } catch (err) {
      debug(`Failed to print the manual skills install command: ${err}`)
    }
  }

  try {
    await submitOfferEvent(outcome, ctx)
  } catch (err) {
    // A telemetry failure after the prompt was shown must not report the run
    // as not prompted, or the caller would show a second prompt via the NPS
    // survey.
    debug(`Failed to submit the skills offer telemetry event: ${err}`)
  }

  return { prompted: true }
}

async function promptForInstall(ctx: SkillsOfferContext): Promise<'accepted' | 'declined' | 'timeout'> {
  let outcome: PromptOutcome<boolean>
  try {
    outcome = await ctx.prompts.confirm({
      message:
        "Install Prisma's agent skills so AI coding tools work better with this project?\n" +
        `This prompt closes in ${promptTimeoutSecs}s and can be suppressed with --no-hints.`,
      timeoutMs: promptTimeoutSecs * 1000,
    })
  } catch (err) {
    // A failed read (e.g. stdin closed under us) counts as no answer, so the
    // offer is still recorded as resolved and generate never asks twice.
    debug(`Failed to read the answer to the skills offer prompt: ${err}`)
    return 'timeout'
  }

  switch (outcome.status) {
    case 'answered':
      return outcome.value ? 'accepted' : 'declined'
    case 'timeout':
      ctx.prompts.message(`No response received within ${promptTimeoutSecs} seconds.`)
      return 'timeout'
    case 'cancelled':
      // Dismissing the prompt is an answer of sorts, and repeating the offer on
      // the next run would be the opposite of what the user just asked for.
      return 'declined'
  }
}

async function skillsAlreadyInstalled(cwd: string): Promise<boolean> {
  if (await fileExists(path.join(cwd, 'skills-lock.json'))) {
    return true
  }

  for (const skillsDir of ['.claude/skills', '.windsurf/skills', '.agents/skills']) {
    const entries = await fs.promises.readdir(path.join(cwd, skillsDir)).catch((err) => {
      // A missing directory just means this tool's skills aren't installed.
      if (err.code === 'ENOENT' || err.code === 'ENOTDIR') {
        return [] as string[]
      }
      throw err
    })
    if (entries.some((entry) => entry.startsWith('prisma-'))) {
      return true
    }
  }

  return false
}

async function writeAcknowledgement(ackPath: string, outcome: SkillsOfferOutcome): Promise<void> {
  const ack: SkillsOfferAcknowledgement = { offeredAt: new Date().toISOString(), outcome }
  try {
    await fs.promises.mkdir(path.dirname(ackPath), { recursive: true })
    await fs.promises.writeFile(ackPath, JSON.stringify(ack))
  } catch (err) {
    // A failed write (e.g. read-only config dir) may repeat the offer on the
    // next run, which is preferable to failing generate.
    debug(`Failed to write the skills offer acknowledgement: ${err}`)
  }
}

async function submitOfferEvent(outcome: SkillsOfferOutcome, ctx: SkillsOfferContext): Promise<void> {
  const signature = await ctx.getSignature()
  await ctx.capture.capture(signature, 'skills_offer_resolved', { outcome, cliVersion: ctx.cliVersion })
}

function fileExists(filePath: string): Promise<boolean> {
  return fs.promises.access(filePath).then(
    () => true,
    (err) => {
      // ENOTDIR means a path segment isn't a directory, so the file can't be there either.
      if (err.code === 'ENOENT' || err.code === 'ENOTDIR') {
        return false
      }
      throw err
    },
  )
}
