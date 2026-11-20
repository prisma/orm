import { stripVTControlCharacters } from 'node:util'

import { vitestConsoleContext, vitestContext } from '@prisma/get-platform/src/test-utils/vitestContext'
import { ensureDir } from 'fs-extra'
import { stdin } from 'mock-stdin'
import prompt from 'prompts'
import tempy from 'tempy'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { ErrorArea, RustPanic } from '..'
import { sendPanic } from '../sendPanic'
import { wouldYouLikeToCreateANewIssue } from '../utils/getGitHubIssueUrl'
import { handlePanic } from '../utils/handlePanic'

const ctx = vitestContext.new().add(vitestConsoleContext()).assemble()

const keys = {
  up: '\x1B\x5B\x41',
  down: '\x1B\x5B\x42',
  enter: '\x0D',
  space: '\x20',
}
const sendKeystrokes = async (io) => {
  io.send(keys.down)
  io.send(keys.enter)
  await delay(10)
}
// helper function for timing
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) // Mock stdin so we can send messages to the CLI

const testRootDir = tempy.directory()

// eslint-disable-next-line @typescript-eslint/unbound-method
const oldProcessCwd = process.cwd

const sendPanicTag = 'send-panic-failed'

vi.mock('../sendPanic', async () => ({
  ...(await vi.importActual('../sendPanic')),
  sendPanic: vi.fn().mockImplementation(() => Promise.reject(new Error(sendPanicTag))),
}))

vi.mock('../utils/getGitHubIssueUrl', async () => ({
  ...(await vi.importActual('../utils/getGitHubIssueUrl')),
  wouldYouLikeToCreateANewIssue: vi.fn().mockImplementation(() => Promise.resolve()),
}))

function restoreEnvSnapshot(snapshot: NodeJS.ProcessEnv) {
  for (const key of Object.keys(process.env)) {
    if (!(key in snapshot)) {
      delete process.env[key]
    }
  }

  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

describe('handlePanic', () => {
  // testing with env https://stackoverflow.com/a/48042799/1345244
  const OLD_ENV = { ...process.env }

  // mock for retrieving the database version
  const getDatabaseVersionSafe = () => Promise.resolve(undefined)

  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()

    restoreEnvSnapshot(OLD_ENV)
    process.env.GITHUB_ACTIONS = 'true' // simulate CI environment
    process.cwd = () => testRootDir

    await ensureDir(testRootDir)
  })

  afterEach(() => {
    process.cwd = oldProcessCwd
    // await del(testRootDir, { force: true }) // Need force: true because `del` does not delete dirs outside the CWD
  })
  let io
  beforeAll(() => (io = stdin()))
  afterAll(() => {
    restoreEnvSnapshot(OLD_ENV) // restore old env
    io.restore()
  })

  const error = new RustPanic('Some error message!', '', undefined, ErrorArea.LIFT_CLI)
  const packageJsonVersion = '0.0.0'
  const enginesVersion = '734ab53bd8e2cadf18b8b71cb53bf2d2bed46517'
  const command = 'something-test'

  // Only works locally (not in CI)
  it.skip('ask to submit the panic error in interactive mode', async () => {
    const oldConsoleLog = console.log
    const logs: string[] = []
    console.log = (...args) => {
      logs.push(...args)
    }

    setTimeout(() => sendKeystrokes(io).then(), 5)

    try {
      await handlePanic({
        error,
        cliVersion: packageJsonVersion,
        enginesVersion: enginesVersion,
        command,
        getDatabaseVersionSafe,
      })
    } catch (e) {
      expect(stripVTControlCharacters(e.message)).toMatchSnapshot()
    }

    console.log = oldConsoleLog
    expect(stripVTControlCharacters(logs.join('\n'))).toMatchSnapshot()
  })

  it('no interactive mode in CI', async () => {
    try {
      await handlePanic({
        error,
        cliVersion: packageJsonVersion,
        enginesVersion,
        command,
        getDatabaseVersionSafe,
      })
    } catch (error) {
      error.schemaPath = 'Some Schema Path'
      expect(error).toMatchInlineSnapshot(`[RustPanic: Some error message!]`)
      expect(JSON.stringify(error)).toMatchInlineSnapshot(
        `"{"__typename":"RustPanic","rustStack":"","area":"LIFT_CLI","name":"RustPanic","schemaPath":"Some Schema Path"}"`,
      )
    }
  })

  it('when sendPanic fails, the user should be alerted by a reportFailedMessage', async () => {
    const cliVersion = 'test-cli-version'
    const enginesVersion = 'test-engine-version'
    const rustStackTrace = 'test-rustStack'
    const command = 'test-command'

    // @ts-expect-error
    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {})

    const rustPanic = new RustPanic(
      'test-message',
      rustStackTrace,
      'test-request',
      ErrorArea.LIFT_CLI, // area
      undefined, // introspectionUrl
    )

    prompt.inject(['y']) // submit report
    await handlePanic({
      error: rustPanic,
      cliVersion,
      enginesVersion,
      command,
      getDatabaseVersionSafe,
    })

    expect(sendPanic).toHaveBeenCalledTimes(1)
    expect(wouldYouLikeToCreateANewIssue).toHaveBeenCalledTimes(1)
    expect(stripVTControlCharacters(ctx.mocked['console.log'].mock.calls.join('\n'))).toMatchSnapshot()
    expect(stripVTControlCharacters(ctx.mocked['console.error'].mock.calls.join('\n'))).toMatch(
      new RegExp(`^Error report submission failed due to:?`),
    )
    expect(mockExit).toHaveBeenCalledWith(1)
    mockExit.mockRestore()
  })
})
