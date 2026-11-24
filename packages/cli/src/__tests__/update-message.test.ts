import { jestConsoleContext, jestContext } from '@prisma/get-platform'

import { printUpdateMessage } from '../utils/printUpdateMessage'

const ctx = jestContext.new().add(jestConsoleContext()).assemble()

describe('update available message', () => {
  let originalPrismaHideUpdateMessageEnv: string | undefined

  beforeEach(() => {
    originalPrismaHideUpdateMessageEnv = process.env.PRISMA_HIDE_UPDATE_MESSAGE
    delete process.env.PRISMA_HIDE_UPDATE_MESSAGE
  })

  afterEach(() => {
    process.env.PRISMA_HIDE_UPDATE_MESSAGE = originalPrismaHideUpdateMessageEnv
  })

  describe('update available', () => {
    it('dev tag - minor', () => {
      printUpdateMessage({
        status: 'ok',
        // @ts-ignore
        data: {
          previous_version: '2.6.1-dev.18',
          current_version: '2.16.0-dev.8',
          package: 'prisma',
          release_tag: 'dev',
          outdated: true,
        },
      })
      const message = ctx.mocked['console.error'].mock.calls[0][0]
      expect(message).toContain('npm i --save-dev prisma@dev')
      expect(message).toContain('npm i @prisma/client@dev')
      expect(message).toMatchSnapshot()
    })

    it('dev tag - major', () => {
      printUpdateMessage({
        status: 'ok',
        // @ts-ignore
        data: {
          previous_version: '2.6.1-dev.18',
          current_version: '3.0.1-dev.8',
          package: 'prisma',
          release_tag: 'dev',
          outdated: true,
        },
      })
      const message = ctx.mocked['console.error'].mock.calls[0][0]
      expect(message).toContain('This is a major update')
      expect(message).not.toContain('npm i')
      expect(message).toMatchSnapshot()
    })

    it('latest tag - minor', () => {
      printUpdateMessage({
        status: 'ok',
        // @ts-ignore
        data: {
          previous_version: '2.6.1',
          current_version: '2.16.0',
          package: 'prisma',
          release_tag: 'latest',
          outdated: true,
        },
      })
      const message = ctx.mocked['console.error'].mock.calls[0][0]
      expect(message).toContain('npm i --save-dev prisma@latest')
      expect(message).toContain('npm i @prisma/client@latest')
      expect(message).toMatchSnapshot()
    })

    it('latest tag - major', () => {
      printUpdateMessage({
        status: 'ok',
        // @ts-ignore
        data: {
          previous_version: '2.6.1',
          current_version: '3.0.0',
          package: 'prisma',
          release_tag: 'latest',
          outdated: true,
        },
      })
      const message = ctx.mocked['console.error'].mock.calls[0][0]
      expect(message).toContain('This is a major update')
      expect(message).not.toContain('npm i')
      expect(message).toMatchSnapshot()
    })

    it('latest tag - major pre-release', () => {
      printUpdateMessage({
        status: 'ok',
        // @ts-ignore
        data: {
          previous_version: '7.10.1',
          current_version: '8.0.0-rc.34',
          package: 'prisma',
          release_tag: 'latest',
          outdated: true,
        },
      })
      const message = ctx.mocked['console.error'].mock.calls[0][0]
      expect(message).toContain('7.10.1 -> 8.0.0-rc.34')
      expect(message).toContain('https://pris.ly/d/major-version-upgrade')
      expect(message).not.toContain('prisma@latest')
      expect(message).not.toContain('@prisma/client@latest')
      expect(message).toMatchSnapshot()
    })
  })

  it('prints nothing if the CLI is up to date', () => {
    printUpdateMessage({
      status: 'ok',
      // @ts-ignore
      data: {
        outdated: false,
      },
    })
    expect(ctx.mocked['console.log']).not.toHaveBeenCalled()
    expect(ctx.mocked['console.info']).not.toHaveBeenCalled()
    expect(ctx.mocked['console.warn']).not.toHaveBeenCalled()
    expect(ctx.mocked['console.error']).not.toHaveBeenCalled()
  })

  it('prints nothing if the checkResult.status is waiting', () => {
    printUpdateMessage({
      status: 'waiting',
      // @ts-ignore
      data: {},
    })
    expect(ctx.mocked['console.log']).not.toHaveBeenCalled()
    expect(ctx.mocked['console.info']).not.toHaveBeenCalled()
    expect(ctx.mocked['console.warn']).not.toHaveBeenCalled()
    expect(ctx.mocked['console.error']).not.toHaveBeenCalled()
  })

  it('prints nothing if the checkResult.status is disabled', () => {
    printUpdateMessage({
      status: 'disabled',
    })
    expect(ctx.mocked['console.log']).not.toHaveBeenCalled()
    expect(ctx.mocked['console.info']).not.toHaveBeenCalled()
    expect(ctx.mocked['console.warn']).not.toHaveBeenCalled()
    expect(ctx.mocked['console.error']).not.toHaveBeenCalled()
  })

  it('prints nothing if the checkResult.status is reminded', () => {
    printUpdateMessage({
      status: 'reminded',
      // @ts-ignore
      data: {},
    })
    expect(ctx.mocked['console.log']).not.toHaveBeenCalled()
    expect(ctx.mocked['console.info']).not.toHaveBeenCalled()
    expect(ctx.mocked['console.warn']).not.toHaveBeenCalled()
    expect(ctx.mocked['console.error']).not.toHaveBeenCalled()
  })

  it('prints nothing if process.env.PRISMA_HIDE_UPDATE_MESSAGE is set', () => {
    process.env.PRISMA_HIDE_UPDATE_MESSAGE = 'true'
    printUpdateMessage({
      status: 'ok',
      // @ts-ignore
      data: {
        previous_version: '2.6.1-dev.18',
        current_version: '3.0.1-dev.8',
        package: 'prisma',
        release_tag: 'dev',
        outdated: true,
      },
    })
    expect(ctx.mocked['console.log']).not.toHaveBeenCalled()
    expect(ctx.mocked['console.info']).not.toHaveBeenCalled()
    expect(ctx.mocked['console.warn']).not.toHaveBeenCalled()
    expect(ctx.mocked['console.error']).not.toHaveBeenCalled()
  })
})
