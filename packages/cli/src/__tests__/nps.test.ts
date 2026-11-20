import fs from 'fs'

import { CommandState } from '../utils/commandState'
import { handleNpsSurveyImpl } from '../utils/nps/survey'

const currentDate = new Date('2022-01-01T00:00:00.000Z')
const laterDate = new Date('2023-01-01T00:00:00.000Z')
const earlierDate = new Date('2021-01-01T00:00:00.000Z')
const evenEarlierDate = new Date('2020-01-01T00:00:00.000Z')

const longTimeUserCommandState: CommandState = { firstCommandTimestamp: '2019-01-01T00:00:00.000Z' }

describe('nps survey', () => {
  const originalEnv = { ...process.env }
  const restoreEnv = () => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key]
      }
    }

    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }

  let mockRead: jest.SpyInstance
  let mockWrite: jest.SpyInstance
  let mockExists: jest.SpyInstance

  beforeEach(() => {
    restoreEnv()
    for (const key of Object.keys(process.env)) {
      delete process.env[key]
    }
  })

  afterEach(() => {
    mockRead?.mockRestore()
    mockWrite?.mockRestore()
    mockExists?.mockRestore()
  })

  afterAll(() => {
    restoreEnv()
  })

  it('should exit immediately if running in CI', async () => {
    mockRead = jest.spyOn(fs.promises, 'readFile').mockImplementation()
    mockWrite = jest.spyOn(fs.promises, 'writeFile').mockImplementation()

    const status = jest.fn()
    const prompts = {
      confirm: jest.fn(),
      text: jest.fn(),
      message: jest.fn(),
    }
    const capture = jest.fn()

    process.env.CI = 'true'
    await handleNpsSurveyImpl(currentDate, { status }, prompts, { capture }, longTimeUserCommandState)

    expect(mockRead).toHaveBeenCalledTimes(0)
    expect(mockWrite).toHaveBeenCalledTimes(0)
    expect(status).toHaveBeenCalledTimes(0)
    expect(prompts.text).toHaveBeenCalledTimes(0)
    expect(capture).toHaveBeenCalledTimes(0)
  })

  it('should exit immediately if running in a Podman container', async () => {
    mockExists = jest.spyOn(fs, 'existsSync').mockImplementation((path) => {
      return path === '/run/.containerenv'
    })

    mockRead = jest.spyOn(fs.promises, 'readFile').mockImplementation()
    mockWrite = jest.spyOn(fs.promises, 'writeFile').mockImplementation()

    const status = jest.fn()
    const prompts = {
      confirm: jest.fn(),
      text: jest.fn(),
      message: jest.fn(),
    }
    const capture = jest.fn()

    await handleNpsSurveyImpl(currentDate, { status }, prompts, { capture }, longTimeUserCommandState)

    expect(mockRead).toHaveBeenCalledTimes(0)
    expect(mockWrite).toHaveBeenCalledTimes(0)
    expect(status).toHaveBeenCalledTimes(0)
    expect(prompts.text).toHaveBeenCalledTimes(0)
    expect(capture).toHaveBeenCalledTimes(0)
  })

  it('should exit immediately if running in a Docker container', async () => {
    mockExists = jest.spyOn(fs, 'existsSync').mockImplementation((path) => {
      return path === '/.dockerenv'
    })

    mockRead = jest.spyOn(fs.promises, 'readFile').mockImplementation()
    mockWrite = jest.spyOn(fs.promises, 'writeFile').mockImplementation()

    const status = jest.fn()
    const prompts = {
      confirm: jest.fn(),
      text: jest.fn(),
      message: jest.fn(),
    }
    const capture = jest.fn()

    await handleNpsSurveyImpl(currentDate, { status }, prompts, { capture }, longTimeUserCommandState)

    expect(mockRead).toHaveBeenCalledTimes(0)
    expect(mockWrite).toHaveBeenCalledTimes(0)
    expect(status).toHaveBeenCalledTimes(0)
    expect(prompts.text).toHaveBeenCalledTimes(0)
    expect(capture).toHaveBeenCalledTimes(0)
  })

  it('should exit immediately if running in a Kubernetes pod', async () => {
    mockRead = jest.spyOn(fs.promises, 'readFile').mockImplementation()
    mockWrite = jest.spyOn(fs.promises, 'writeFile').mockImplementation()

    const status = jest.fn()
    const prompts = {
      confirm: jest.fn(),
      text: jest.fn(),
      message: jest.fn(),
    }
    const capture = jest.fn()

    process.env.KUBERNETES_SERVICE_HOST = '10.96.0.1'
    await handleNpsSurveyImpl(currentDate, { status }, prompts, { capture }, longTimeUserCommandState)

    expect(mockRead).toHaveBeenCalledTimes(0)
    expect(mockWrite).toHaveBeenCalledTimes(0)
    expect(status).toHaveBeenCalledTimes(0)
    expect(prompts.text).toHaveBeenCalledTimes(0)
    expect(capture).toHaveBeenCalledTimes(0)
  })

  it('should exit immediately if running in a pre-commit git hook', async () => {
    mockRead = jest.spyOn(fs.promises, 'readFile').mockImplementation()
    mockWrite = jest.spyOn(fs.promises, 'writeFile').mockImplementation()

    const status = jest.fn()
    const prompts = {
      confirm: jest.fn(),
      text: jest.fn(),
      message: jest.fn(),
    }
    const capture = jest.fn()

    process.env.GIT_EXEC_PATH = '/nix/store/9z3jhc0rlj3zaw8nd1zka9vli6w0q11g-git-2.47.2/libexec/git-core'
    await handleNpsSurveyImpl(currentDate, { status }, prompts, { capture }, longTimeUserCommandState)

    expect(mockRead).toHaveBeenCalledTimes(0)
    expect(mockWrite).toHaveBeenCalledTimes(0)
    expect(status).toHaveBeenCalledTimes(0)
    expect(prompts.text).toHaveBeenCalledTimes(0)
    expect(capture).toHaveBeenCalledTimes(0)
  })

  it('should exit immediately if running in a post-install npm hook or similar', async () => {
    mockRead = jest.spyOn(fs.promises, 'readFile').mockImplementation()
    mockWrite = jest.spyOn(fs.promises, 'writeFile').mockImplementation()

    const status = jest.fn()
    const prompts = {
      confirm: jest.fn(),
      text: jest.fn(),
      message: jest.fn(),
    }
    const capture = jest.fn()

    process.env.npm_command = 'install'
    process.env.npm_lifecycle_event = 'prepare'
    await handleNpsSurveyImpl(currentDate, { status }, prompts, { capture }, longTimeUserCommandState)

    expect(mockRead).toHaveBeenCalledTimes(0)
    expect(mockWrite).toHaveBeenCalledTimes(0)
    expect(status).toHaveBeenCalledTimes(0)
    expect(prompts.text).toHaveBeenCalledTimes(0)
    expect(capture).toHaveBeenCalledTimes(0)
  })

  it('should read the config and exit when the current survey has been acknowledged', async () => {
    mockRead = jest
      .spyOn(fs.promises, 'readFile')
      .mockResolvedValue(
        JSON.stringify({ acknowledgedTimeframe: { start: earlierDate.toISOString(), end: laterDate.toISOString() } }),
      )
    mockWrite = jest.spyOn(fs.promises, 'writeFile').mockImplementation()

    const status = jest.fn()
    const prompts = {
      confirm: jest.fn(),
      text: jest.fn(),
      message: jest.fn(),
    }
    const capture = jest.fn()

    await handleNpsSurveyImpl(currentDate, { status }, prompts, { capture }, longTimeUserCommandState)

    expect(mockRead).toHaveBeenCalledTimes(1)
    expect(mockWrite).toHaveBeenCalledTimes(0)
    expect(status).toHaveBeenCalledTimes(0)
    expect(prompts.text).toHaveBeenCalledTimes(0)
    expect(capture).toHaveBeenCalledTimes(0)
  })

  it('should check the status if there is no config and exit if there is no survey', async () => {
    mockRead = jest.spyOn(fs.promises, 'readFile').mockRejectedValue({ code: 'ENOENT' })
    mockWrite = jest.spyOn(fs.promises, 'writeFile').mockImplementation()

    const status = jest
      .fn()
      .mockResolvedValue({ currentTimeframe: { start: evenEarlierDate.toISOString(), end: earlierDate.toISOString() } })
    const prompts = {
      confirm: jest.fn(),
      text: jest.fn(),
      message: jest.fn(),
    }
    const capture = jest.fn()

    await handleNpsSurveyImpl(currentDate, { status }, prompts, { capture }, longTimeUserCommandState)

    expect(mockRead).toHaveBeenCalledTimes(1)
    expect(mockWrite).toHaveBeenCalledTimes(0)
    expect(status).toHaveBeenCalledTimes(1)
    expect(prompts.text).toHaveBeenCalledTimes(0)
    expect(capture).toHaveBeenCalledTimes(0)
  })

  it('should check the status if the acknowledged survey has expired', async () => {
    mockRead = jest.spyOn(fs.promises, 'readFile').mockResolvedValue(
      JSON.stringify({
        acknowledgedTimeframe: { start: evenEarlierDate.toISOString(), end: earlierDate.toISOString() },
      }),
    )
    mockWrite = jest.spyOn(fs.promises, 'writeFile').mockImplementation()

    const status = jest.fn().mockResolvedValue({})
    const prompts = {
      confirm: jest.fn(),
      text: jest.fn(),
      message: jest.fn(),
    }
    const capture = jest.fn()

    await handleNpsSurveyImpl(currentDate, { status }, prompts, { capture }, longTimeUserCommandState)

    expect(mockRead).toHaveBeenCalledTimes(1)
    expect(mockWrite).toHaveBeenCalledTimes(0)
    expect(status).toHaveBeenCalledTimes(1)
    expect(prompts.text).toHaveBeenCalledTimes(0)
    expect(capture).toHaveBeenCalledTimes(0)
  })

  it('should exit if the status is undefined', async () => {
    mockRead = jest.spyOn(fs.promises, 'readFile').mockRejectedValue({ code: 'ENOENT' })
    mockWrite = jest.spyOn(fs.promises, 'writeFile').mockImplementation()

    const status = jest.fn().mockResolvedValue({})
    const prompts = {
      confirm: jest.fn(),
      text: jest.fn(),
      message: jest.fn(),
    }
    const capture = jest.fn().mockReturnValue(Promise.resolve())

    await handleNpsSurveyImpl(currentDate, { status }, prompts, { capture }, longTimeUserCommandState)

    expect(mockRead).toHaveBeenCalledTimes(1)
    expect(mockWrite).toHaveBeenCalledTimes(0)
    expect(status).toHaveBeenCalledTimes(1)
    expect(prompts.text).toHaveBeenCalledTimes(0)
    expect(capture).toHaveBeenCalledTimes(0)
  })

  it('should exit if this command is within 24 hours of the first command issued', async () => {
    const status = jest.fn().mockResolvedValue({})
    const prompts = {
      confirm: jest.fn(),
      text: jest.fn(),
      message: jest.fn(),
    }
    const capture = jest.fn().mockReturnValue(Promise.resolve())
    const commandState = {
      firstCommandTimestamp: new Date(
        Date.now() - ((Math.random() * Number.MAX_SAFE_INTEGER) % (23 * 60 * 60 * 1000)),
      ).toISOString(),
    }

    await handleNpsSurveyImpl(currentDate, { status }, prompts, { capture }, commandState)

    expect(status).toHaveBeenCalledTimes(0)
    expect(prompts.text).toHaveBeenCalledTimes(0)
    expect(capture).toHaveBeenCalledTimes(0)
  })

  it('should prompt the user if the survey is active and update the config', async () => {
    mockRead = jest.spyOn(fs.promises, 'readFile').mockRejectedValue({ code: 'ENOENT' })
    mockWrite = jest.spyOn(fs.promises, 'writeFile').mockImplementation()

    const currentTimeframe = { start: earlierDate.toISOString(), end: laterDate.toISOString() }
    const status = jest.fn().mockResolvedValue({ currentTimeframe })
    const prompts = {
      confirm: jest.fn(),
      text: jest
        .fn()
        .mockResolvedValueOnce({ status: 'answered', value: '5' })
        .mockResolvedValueOnce({ status: 'answered', value: 'Great!' }),
      message: jest.fn(),
    }
    const capture = jest.fn().mockReturnValue(Promise.resolve())

    await handleNpsSurveyImpl(currentDate, { status }, prompts, { capture }, longTimeUserCommandState)

    expect(mockRead).toHaveBeenCalled()
    expect(mockWrite).toHaveBeenLastCalledWith(
      expect.anything(),
      JSON.stringify({ acknowledgedTimeframe: currentTimeframe }),
    )
    expect(status).toHaveBeenCalledTimes(1)
    expect(prompts.text).toHaveBeenCalledTimes(2)
    expect(prompts.message).toHaveBeenCalledWith('Thanks for your feedback!')
    expect(capture).toHaveBeenCalledWith(expect.anything(), 'NPS feedback', { rating: 5, feedback: 'Great!' })
  })

  it('should allow the user to skip the survey and still update the config', async () => {
    mockRead = jest.spyOn(fs.promises, 'readFile').mockRejectedValue({ code: 'ENOENT' })
    mockWrite = jest.spyOn(fs.promises, 'writeFile').mockImplementation()

    const currentTimeframe = { start: earlierDate.toISOString(), end: laterDate.toISOString() }
    const status = jest.fn().mockResolvedValue({ currentTimeframe })
    const prompts = {
      confirm: jest.fn(),
      text: jest.fn().mockResolvedValueOnce({ status: 'answered', value: 'no' }),
      message: jest.fn(),
    }
    const capture = jest.fn().mockReturnValue(Promise.resolve())

    await handleNpsSurveyImpl(currentDate, { status }, prompts, { capture }, longTimeUserCommandState)

    expect(mockRead).toHaveBeenCalledTimes(1)
    expect(mockWrite).toHaveBeenCalledWith(
      expect.anything(),
      JSON.stringify({ acknowledgedTimeframe: currentTimeframe }),
    )
    expect(status).toHaveBeenCalledTimes(1)
    expect(prompts.text).toHaveBeenCalledTimes(1)
    expect(prompts.message).toHaveBeenCalledWith('Not received a valid rating. Exiting the survey.')
    expect(capture).toHaveBeenCalledTimes(0)
  })
  it('should exit the survey when the rating prompt times out', async () => {
    mockRead = jest.spyOn(fs.promises, 'readFile').mockRejectedValue({ code: 'ENOENT' })
    mockWrite = jest.spyOn(fs.promises, 'writeFile').mockImplementation()

    const currentTimeframe = { start: earlierDate.toISOString(), end: laterDate.toISOString() }
    const status = jest.fn().mockResolvedValue({ currentTimeframe })
    const prompts = {
      confirm: jest.fn(),
      text: jest.fn().mockResolvedValueOnce({ status: 'timeout' }),
      message: jest.fn(),
    }
    const capture = jest.fn().mockReturnValue(Promise.resolve())

    await handleNpsSurveyImpl(currentDate, { status }, prompts, { capture }, longTimeUserCommandState)

    expect(prompts.text).toHaveBeenCalledTimes(1)
    expect(prompts.message).toHaveBeenCalledWith('No response received within 30 seconds. Exiting the survey.')
    expect(capture).toHaveBeenCalledTimes(0)
    // the timeframe is still acknowledged, so a timed out survey is not repeated
    expect(mockWrite).toHaveBeenCalledWith(
      expect.anything(),
      JSON.stringify({ acknowledgedTimeframe: currentTimeframe }),
    )
  })

  it('should exit the survey quietly when the user dismisses the rating prompt', async () => {
    mockRead = jest.spyOn(fs.promises, 'readFile').mockRejectedValue({ code: 'ENOENT' })
    mockWrite = jest.spyOn(fs.promises, 'writeFile').mockImplementation()

    const currentTimeframe = { start: earlierDate.toISOString(), end: laterDate.toISOString() }
    const status = jest.fn().mockResolvedValue({ currentTimeframe })
    const prompts = {
      confirm: jest.fn(),
      text: jest.fn().mockResolvedValueOnce({ status: 'cancelled' }),
      message: jest.fn(),
    }
    const capture = jest.fn().mockReturnValue(Promise.resolve())

    await handleNpsSurveyImpl(currentDate, { status }, prompts, { capture }, longTimeUserCommandState)

    expect(prompts.text).toHaveBeenCalledTimes(1)
    expect(prompts.message).not.toHaveBeenCalled()
    expect(capture).toHaveBeenCalledTimes(0)
    expect(mockWrite).toHaveBeenCalledWith(
      expect.anything(),
      JSON.stringify({ acknowledgedTimeframe: currentTimeframe }),
    )
  })

  it('should submit a rating without feedback when the feedback prompt is dismissed', async () => {
    mockRead = jest.spyOn(fs.promises, 'readFile').mockRejectedValue({ code: 'ENOENT' })
    mockWrite = jest.spyOn(fs.promises, 'writeFile').mockImplementation()

    const currentTimeframe = { start: earlierDate.toISOString(), end: laterDate.toISOString() }
    const status = jest.fn().mockResolvedValue({ currentTimeframe })
    const prompts = {
      confirm: jest.fn(),
      text: jest
        .fn()
        .mockResolvedValueOnce({ status: 'answered', value: '9' })
        .mockResolvedValueOnce({ status: 'cancelled' }),
      message: jest.fn(),
    }
    const capture = jest.fn().mockReturnValue(Promise.resolve())

    await handleNpsSurveyImpl(currentDate, { status }, prompts, { capture }, longTimeUserCommandState)

    expect(capture).toHaveBeenCalledWith(expect.anything(), 'NPS feedback', { rating: 9, feedback: undefined })
  })

  // 0 is a valid rating and the most negative signal the survey can collect, so
  // it must not be mistaken for the absence of an answer.
  it('should submit a rating of 0', async () => {
    mockRead = jest.spyOn(fs.promises, 'readFile').mockRejectedValue({ code: 'ENOENT' })
    mockWrite = jest.spyOn(fs.promises, 'writeFile').mockImplementation()

    const currentTimeframe = { start: earlierDate.toISOString(), end: laterDate.toISOString() }
    const status = jest.fn().mockResolvedValue({ currentTimeframe })
    const prompts = {
      confirm: jest.fn(),
      text: jest
        .fn()
        .mockResolvedValueOnce({ status: 'answered', value: '0' })
        .mockResolvedValueOnce({ status: 'answered', value: 'Nothing works.' }),
      message: jest.fn(),
    }
    const capture = jest.fn().mockReturnValue(Promise.resolve())

    await handleNpsSurveyImpl(currentDate, { status }, prompts, { capture }, longTimeUserCommandState)

    expect(capture).toHaveBeenCalledWith(expect.anything(), 'NPS feedback', {
      rating: 0,
      feedback: 'Nothing works.',
    })
    expect(prompts.message).toHaveBeenCalledWith('Thanks for your feedback!')
  })

  it('should give the feedback prompt a deadline of its own', async () => {
    mockRead = jest.spyOn(fs.promises, 'readFile').mockRejectedValue({ code: 'ENOENT' })
    mockWrite = jest.spyOn(fs.promises, 'writeFile').mockImplementation()

    const currentTimeframe = { start: earlierDate.toISOString(), end: laterDate.toISOString() }
    const status = jest.fn().mockResolvedValue({ currentTimeframe })
    const prompts = {
      confirm: jest.fn(),
      text: jest
        .fn()
        .mockResolvedValueOnce({ status: 'answered', value: '7' })
        .mockResolvedValueOnce({ status: 'timeout' }),
      message: jest.fn(),
    }
    const capture = jest.fn().mockReturnValue(Promise.resolve())

    await handleNpsSurveyImpl(currentDate, { status }, prompts, { capture }, longTimeUserCommandState)

    for (const call of prompts.text.mock.calls) {
      expect(call[0].timeoutMs).toBe(30_000)
    }
    // a rating already given is still worth submitting without the follow-up
    expect(capture).toHaveBeenCalledWith(expect.anything(), 'NPS feedback', { rating: 7, feedback: undefined })
  })
})
