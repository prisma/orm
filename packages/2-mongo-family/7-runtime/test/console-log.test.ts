import type { RuntimeLog } from '@internal/framework-components/runtime';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { consoleLog, runtimeLog } from '../src/console-log';

describe('consoleLog', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends each level to its console method and has no debug', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    consoleLog.info({ event: 'i' });
    consoleLog.warn({ event: 'w' });
    consoleLog.error({ event: 'e' });

    expect({
      info: info.mock.calls,
      warn: warn.mock.calls,
      error: error.mock.calls,
      debug: consoleLog.debug,
    }).toEqual({
      info: [[{ event: 'i' }]],
      warn: [[{ event: 'w' }]],
      error: [[{ event: 'e' }]],
      debug: undefined,
    });
  });
});

describe('runtimeLog', () => {
  it('forwards debug events to a log that has debug', () => {
    const debug = vi.fn();
    const log = runtimeLog({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug });

    log.debug?.({ event: 'd' });

    expect(debug.mock.calls).toEqual([[{ event: 'd' }]]);
  });

  it('ignores a debug event once the log has dropped its debug method', () => {
    const source: { debug: ((event: unknown) => void) | undefined } & Omit<RuntimeLog, 'debug'> = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
    const log = runtimeLog(source as RuntimeLog);
    source.debug = undefined;

    expect(() => log.debug?.({ event: 'd' })).not.toThrow();
  });

  it('discards an error a debug method throws', () => {
    const log = runtimeLog({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: () => {
        throw new Error('debug failed');
      },
    });

    expect(() => log.debug?.({ event: 'd' })).not.toThrow();
  });
});
