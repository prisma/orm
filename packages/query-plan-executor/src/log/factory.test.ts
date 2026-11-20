import { describe, expect, it, vi } from 'vitest'

import { createConsoleLogger } from './factory'

describe('createConsoleLogger', () => {
  it('drops all logs when log level is off', () => {
    using debugSpy = vi.spyOn(console, 'debug')
    using logSpy = vi.spyOn(console, 'log')
    using infoSpy = vi.spyOn(console, 'info')
    using warnSpy = vi.spyOn(console, 'warn')
    using errorSpy = vi.spyOn(console, 'error')

    const logger = createConsoleLogger('text', 'off')

    logger.debug('debug message')
    logger.query('query message')
    logger.info('info message')
    logger.warn('warn message')
    logger.error('error message')

    expect(debugSpy).not.toHaveBeenCalled()
    expect(logSpy).not.toHaveBeenCalled()
    expect(infoSpy).not.toHaveBeenCalled()
    expect(warnSpy).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('respects threshold filtering for regular log levels', () => {
    using debugSpy = vi.spyOn(console, 'debug')
    using infoSpy = vi.spyOn(console, 'info')
    using warnSpy = vi.spyOn(console, 'warn')
    using errorSpy = vi.spyOn(console, 'error')

    const logger = createConsoleLogger('text', 'info')

    logger.debug('debug message')
    logger.info('info message')
    logger.warn('warn message')
    logger.error('error message')

    expect(debugSpy).not.toHaveBeenCalled()
    expect(infoSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(errorSpy).toHaveBeenCalledTimes(1)
  })
})
