import events from 'node:events'
import path from 'node:path'

import { execa, type ExecaChildProcess } from 'execa'

import { generateTestClient } from '../../../../utils/getTestClient'
import { EXIT_MESSAGE, READY_MESSAGE } from './__helpers__/constants'

const testIf = (condition: boolean) => (condition ? test : test.skip)

const userSignalsSupportedByOperatingSystem = process.platform !== 'win32'

function spawnChild() {
  const childPath = path.join(__dirname, '__helpers__', 'client.ts')
  return execa('node', ['-r', '@swc-node/register', childPath], {
    // Don't reject the promise if the process exits on signal.
    reject: false,
  })
}

async function waitMessageOnStdout(child: ExecaChildProcess): Promise<string> {
  const [message] = await events.once(child.stdout!, 'data')
  return message.toString().trim()
}

describe('signals that should terminate the process', () => {
  beforeAll(async () => {
    await generateTestClient()
  })

  test('SIGINT', async () => {
    const child = spawnChild()
    expect(await waitMessageOnStdout(child)).toBe(READY_MESSAGE)
    child.kill('SIGINT')
    expect((await child).stdout).toBe('')
  })

  test('SIGTERM', async () => {
    const child = spawnChild()
    expect(await waitMessageOnStdout(child)).toBe(READY_MESSAGE)
    child.kill('SIGTERM')
    expect((await child).stdout).toBe('')
  })

  testIf(userSignalsSupportedByOperatingSystem)('SIGUSR2', async () => {
    const child = spawnChild()
    expect(await waitMessageOnStdout(child)).toBe(READY_MESSAGE)
    child.kill('SIGUSR2')
    expect((await child).stdout).toBe('')
  })
})

describe('Node.js debugger signal', () => {
  testIf(userSignalsSupportedByOperatingSystem)('SIGUSR1', async () => {
    const child = spawnChild()
    expect(await waitMessageOnStdout(child)).toBe(READY_MESSAGE)
    child.kill('SIGUSR1')
    const result = await child
    expect(result.stdout).toBe(EXIT_MESSAGE)
    expect(result.stderr).toMatch(/Debugger listening/)
  })
})
