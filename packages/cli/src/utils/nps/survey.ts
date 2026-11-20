import Debug from '@prisma/debug'
import { isCi, isInContainer, isInNpmLifecycleHook, isInteractive, maybeInGitHook } from '@prisma/internals'
import * as checkpoint from 'checkpoint-client'
import paths from 'env-paths'
import fs from 'fs'
import path from 'path'

import { CommandState, daysSinceFirstCommand, loadOrInitializeCommandState } from '../commandState'
import { clackPrompts, type Prompts } from '../prompts'
import { EventCapture, PosthogEventCapture, PUBLIC_POSTHOG_NPS_PROJECT_KEY } from './capture'
import { NpsStatusLookup, ProdNpsStatusLookup, Timeframe } from './status'

type NpsConfig = {
  acknowledgedTimeframe: Timeframe
}

type NpsSurveyResult = {
  rating?: number
  feedback?: string
}

type NpsSurveyEvent = {
  rating: number
  feedback?: string
}

const promptTimeoutSecs = 30

const debug = Debug('prisma:cli:nps')

export async function handleNpsSurvey() {
  if (!isInteractive()) {
    // no point in running the NPS survey if there's no TTY
    return
  }

  const now = new Date()

  const status = new ProdNpsStatusLookup()
  const eventCapture = new PosthogEventCapture(PUBLIC_POSTHOG_NPS_PROJECT_KEY)

  await loadOrInitializeCommandState()
    .then((state) => handleNpsSurveyImpl(now, status, clackPrompts, eventCapture, state))
    .catch((err) => {
      // we don't want to propagate NPS survey errors, so we catch them here and log them
      debug(`An error occurred while handling NPS survey: ${err}`)
    })
}

export async function handleNpsSurveyImpl(
  now: Date,
  statusLookup: NpsStatusLookup,
  prompts: Prompts,
  eventCapture: EventCapture,
  commandState: CommandState,
) {
  if (
    isCi() ||
    maybeInGitHook() ||
    isInNpmLifecycleHook() ||
    isInContainer() ||
    daysSinceFirstCommand(commandState) < 1
  ) {
    return
  }

  const config = await readConfig()
  if (config && isWithinTimeframe(now, config.acknowledgedTimeframe)) {
    // the user has already acknowledged an NPS survey covering the current date
    return
  }

  const status = await statusLookup.status()
  if (!status.currentTimeframe || !isWithinTimeframe(now, status.currentTimeframe)) {
    // no NPS survey is currently active
    return
  }

  const result = await collectFeedback(prompts)

  // A rating of 0 is the strongest signal the survey can collect, so this
  // checks for an answer rather than for a truthy one.
  if (result.rating !== undefined) {
    await submitSurveyEvent({ ...result, rating: result.rating }, eventCapture)
    prompts.message('Thanks for your feedback!')
  }

  await writeConfig({ acknowledgedTimeframe: status.currentTimeframe })
}

async function collectFeedback(prompts: Prompts): Promise<NpsSurveyResult> {
  const ratingAnswer = await prompts.text({
    message:
      'How likely are you to recommend Prisma?\n' +
      'Enter a number from 0 to 10 (0 = not at all, 10 = extremely likely), ' +
      'or leave blank to skip and not be asked again.\n' +
      `This prompt closes in ${promptTimeoutSecs}s and can be suppressed with --no-hints. ` +
      'Learn more: https://pris.ly/why-nps',
    placeholder: '0-10',
    timeoutMs: promptTimeoutSecs * 1000,
  })

  if (ratingAnswer.status === 'timeout') {
    prompts.message(`No response received within ${promptTimeoutSecs} seconds. Exiting the survey.`)
    return {}
  }

  if (ratingAnswer.status === 'cancelled') {
    return {}
  }

  const rating = parseInt(ratingAnswer.value.trim(), 10)
  if (isNaN(rating) || rating < 0 || rating > 10) {
    prompts.message('Not received a valid rating. Exiting the survey.')
    return {}
  }

  const feedbackAnswer = await prompts.text({
    message: 'Optional: Provide additional feedback, or leave blank to skip.',
    timeoutMs: promptTimeoutSecs * 1000,
  })
  const feedback =
    feedbackAnswer.status === 'answered' && feedbackAnswer.value.trim() !== '' ? feedbackAnswer.value : undefined

  return { rating, feedback }
}

function getConfigPath(): string {
  return path.join(paths('prisma').config, 'nps.json')
}

async function readConfig(): Promise<NpsConfig | undefined> {
  const data = await fs.promises
    .readFile(getConfigPath(), 'utf-8')
    .catch((err) => (err.code === 'ENOENT' ? Promise.resolve(undefined) : Promise.reject(err)))
  if (data === undefined) {
    return undefined
  }

  const obj = JSON.parse(data)
  if (
    obj.acknowledgedTimeframe &&
    typeof obj.acknowledgedTimeframe.start === 'string' &&
    typeof obj.acknowledgedTimeframe.end === 'string'
  ) {
    return obj
  } else {
    throw new Error('Invalid NPS config schema')
  }
}

async function writeConfig(config: NpsConfig) {
  const configPath = getConfigPath()
  await fs.promises.mkdir(path.dirname(configPath), { recursive: true })
  await fs.promises.writeFile(configPath, JSON.stringify(config))
}

async function submitSurveyEvent(event: NpsSurveyEvent, eventCapture: EventCapture) {
  const signature = await checkpoint.getSignature()
  await eventCapture.capture(signature, 'NPS feedback', event)
}

function isWithinTimeframe(date: Date, timeframe: Timeframe): boolean {
  return new Date(timeframe.start) <= date && new Date(timeframe.end) >= date
}
