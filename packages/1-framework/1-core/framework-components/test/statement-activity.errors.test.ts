import { describe, expect, it, vi } from 'vitest';
import { streamStatement } from '../src/execution/run-with-middleware';
import type { RuntimeMiddleware } from '../src/execution/runtime-middleware';
import {
  collect,
  contextFields,
  exec,
  executeStatementWith,
  type MockExec,
  queryStatement,
  recorder,
  yieldRows,
} from './statement-fixtures';

const lifecycle = (events: readonly string[]) =>
  events.filter((event) => /:(started|ended|finalized):/.test(event));

describe('statement activity errors', () => {
  describe('activityEnded', () => {
    it.each(['query', 'execute'] as const)(
      'fails a successful %s with its error, after every middleware saw the end and it was finalized',
      async (operation) => {
        const events: string[] = [];
        const endedError = new Error('latency budget exceeded');
        const budget: RuntimeMiddleware<MockExec> = {
          name: 'budget',
          async activityEnded() {
            throw endedError;
          },
        };
        const middleware = [budget, recorder('later', events)];

        const pending =
          operation === 'query'
            ? collect(queryStatement(middleware, () => yieldRows([{ id: 1 }])))
            : executeStatementWith(middleware, async () => ({ affectedRows: 1 }));

        await expect(pending).rejects.toBe(endedError);
        expect(lifecycle(events)).toEqual([
          'later:started:statement',
          'later:ended:statement:succeeded',
          'later:finalized:statement:committed',
        ]);
      },
    );

    it('fails the activity with the first error when several activityEnded hooks throw', async () => {
      const first = new Error('first');
      const thrower = (name: string, error: Error): RuntimeMiddleware<MockExec> => ({
        name,
        async activityEnded() {
          throw error;
        },
      });
      const events: string[] = [];

      await expect(
        executeStatementWith(
          [thrower('a', first), thrower('b', new Error('second')), recorder('later', events)],
          async () => ({ affectedRows: 1 }),
        ),
      ).rejects.toBe(first);
      expect(events).toContain('later:ended:statement:succeeded');
    });

    it.each(['query', 'execute'] as const)(
      'is swallowed when the %s failed, so the original error reaches the caller',
      async (operation) => {
        const events: string[] = [];
        const original = new Error('driver failed');
        const noisy: RuntimeMiddleware<MockExec> = {
          name: 'noisy',
          async activityEnded() {
            throw new Error('ended failed');
          },
        };
        const middleware = [noisy, recorder('later', events)];

        const pending =
          operation === 'query'
            ? collect(
                queryStatement(middleware, async function* () {
                  yield* [];
                  throw original;
                }),
              )
            : executeStatementWith(middleware, async () => {
                throw original;
              });

        await expect(pending).rejects.toBe(original);
        expect(lifecycle(events)).toEqual([
          'later:started:statement',
          'later:ended:statement:failed',
          'later:finalized:statement:unknown',
        ]);
      },
    );
  });

  describe('an activityEnded error after a failure', () => {
    it('is passed to ctx.log.error as middleware.activityEnded.error', async () => {
      const error = vi.fn();
      const hookError = new Error('ended failed');
      const noisy: RuntimeMiddleware<MockExec> = {
        name: 'noisy',
        async activityEnded() {
          throw hookError;
        },
      };
      const context = contextFields({ log: { info: vi.fn(), warn: vi.fn(), error } });

      await expect(
        executeStatementWith(
          [noisy],
          async () => {
            throw new Error('driver failed');
          },
          { context },
        ),
      ).rejects.toThrow('driver failed');

      expect(error).toHaveBeenCalledWith({
        event: 'middleware.activityEnded.error',
        middleware: 'noisy',
        error: hookError,
      });
    });
  });

  describe('activityFinalized', () => {
    it('logs a thrown error, swallows it and still runs later middleware', async () => {
      const error = vi.fn();
      const failure = new Error('finalized failed');
      const later = vi.fn(async () => {});
      const middleware: RuntimeMiddleware<MockExec>[] = [
        {
          name: 'failing',
          async activityFinalized() {
            throw failure;
          },
        },
        { name: 'later', activityFinalized: later },
      ];
      const context = contextFields({ log: { info: vi.fn(), warn: vi.fn(), error } });

      await expect(
        collect(queryStatement(middleware, () => yieldRows([{ id: 1 }]), { context })),
      ).resolves.toEqual([{ id: 1 }]);

      expect(error).toHaveBeenCalledWith({
        event: 'middleware.activityFinalized.error',
        middleware: 'failing',
        error: failure,
      });
      expect(later).toHaveBeenCalledTimes(1);
    });

    it('still runs later middleware when logging the error throws too', async () => {
      const later = vi.fn(async () => {});
      const middleware: RuntimeMiddleware<MockExec>[] = [
        {
          name: 'failing',
          async activityFinalized() {
            throw new Error('finalized failed');
          },
        },
        { name: 'later', activityFinalized: later },
      ];
      const context = contextFields({
        log: {
          info: vi.fn(),
          warn: vi.fn(),
          error: () => {
            throw new Error('log failed');
          },
        },
      });

      await expect(
        executeStatementWith(middleware, async () => ({ affectedRows: 1 }), { context }),
      ).resolves.toEqual({ affectedRows: 1 });
      expect(later).toHaveBeenCalledTimes(1);
    });

    it('resolves the statement only after every finalized hook has resolved', async () => {
      const events: string[] = [];
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const middleware: RuntimeMiddleware<MockExec>[] = [
        {
          name: 'deferred',
          async activityFinalized() {
            await gate;
            events.push('deferred resolved');
          },
        },
      ];

      const pending = executeStatementWith(middleware, async () => ({ affectedRows: 1 })).then(() =>
        events.push('statement resolved'),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      events.push('released');
      release();
      await pending;

      expect(events).toEqual(['released', 'deferred resolved', 'statement resolved']);
    });
  });

  describe('every started statement ends and is finalized exactly once', () => {
    it.each(['query', 'execute'] as const)(
      'when beforeEncode throws on a %s',
      async (operation) => {
        const events: string[] = [];
        const blocked = new Error('lint blocked the statement');
        const lint: RuntimeMiddleware<MockExec> = {
          name: 'lint',
          beforeEncode() {
            throw blocked;
          },
        };
        const driver = vi.fn();
        const middleware = [recorder('A', events), lint];

        const pending =
          operation === 'query'
            ? collect(queryStatement(middleware, driver))
            : executeStatementWith(middleware, driver);

        await expect(pending).rejects.toBe(blocked);
        expect(events).toEqual([
          'A:started:statement',
          'A:beforeEncode',
          'A:ended:statement:failed',
          'A:finalized:statement:unknown',
        ]);
        expect(driver).not.toHaveBeenCalled();
      },
    );

    it.each(['query', 'execute'] as const)(
      'when activityStarted throws on a %s, for the middleware whose activityStarted ran',
      async (operation) => {
        const events: string[] = [];
        const refused = new Error('started failed');
        const failing: RuntimeMiddleware<MockExec> = {
          ...recorder('failing', events),
          async activityStarted() {
            events.push('failing:started:statement');
            throw refused;
          },
        };
        const middleware = [recorder('A', events), failing, recorder('B', events)];
        const driver = vi.fn();

        const pending =
          operation === 'query'
            ? collect(queryStatement(middleware, driver))
            : executeStatementWith(middleware, driver);

        await expect(pending).rejects.toBe(refused);
        expect(lifecycle(events)).toEqual([
          'A:started:statement',
          'failing:started:statement',
          'A:ended:statement:failed',
          'failing:ended:statement:failed',
          'A:finalized:statement:unknown',
          'failing:finalized:statement:unknown',
        ]);
        expect(driver).not.toHaveBeenCalled();
      },
    );

    it('when an onQuery handler throws, with source middleware', async () => {
      const events: string[] = [];
      const boom = new Error('onQuery failed');
      let source: string | undefined;
      const interceptor: RuntimeMiddleware<MockExec> = {
        name: 'interceptor',
        intercept: {
          async onQuery() {
            throw boom;
          },
        },
        async activityEnded(_activity, result) {
          if (result.kind === 'statement') source = result.source;
        },
      };

      await expect(
        collect(queryStatement([interceptor, recorder('A', events)], () => yieldRows([]))),
      ).rejects.toBe(boom);

      expect(source).toBe('middleware');
      expect(lifecycle(events)).toEqual([
        'A:started:statement',
        'A:ended:statement:failed',
        'A:finalized:statement:unknown',
      ]);
    });

    it('when the caller stops reading the rows, as stopped and finalized unknown', async () => {
      const events: string[] = [];

      for await (const _row of queryStatement([recorder('A', events)], () =>
        yieldRows([{ id: 1 }, { id: 2 }]),
      )) {
        break;
      }

      expect(lifecycle(events)).toEqual([
        'A:started:statement',
        'A:ended:statement:stopped',
        'A:finalized:statement:unknown',
      ]);
    });

    it('when the caller throws into the rows after the first row, as stopped', async () => {
      const events: string[] = [];
      const failure = new Error('caller failed');
      const iterator = queryStatement([recorder('A', events)], () =>
        yieldRows([{ id: 1 }, { id: 2 }]),
      )[Symbol.asyncIterator]();

      await iterator.next();
      await expect(iterator.throw?.(failure)).rejects.toBe(failure);
      await iterator.return?.();

      expect(lifecycle(events)).toEqual([
        'A:started:statement',
        'A:ended:statement:stopped',
        'A:finalized:statement:unknown',
      ]);
    });

    it('as failed when the rows answer an error the caller threw in with one of their own', async () => {
      const events: string[] = [];
      const rowsFailure = new Error('rows failed');
      const rowsThatFailWhenThrownInto = (): AsyncIterable<Record<string, unknown>> => ({
        [Symbol.asyncIterator]: () => ({
          next: async () => ({ done: false, value: { id: 1 } }),
          throw: async () => {
            throw rowsFailure;
          },
        }),
      });
      const iterator = streamStatement(
        {
          middleware: [recorder('A', events)],
          plan: exec,
          context: contextFields(),
          parent: undefined,
        },
        rowsThatFailWhenThrownInto,
      )[Symbol.asyncIterator]();

      await iterator.next();
      await expect(iterator.throw?.(new Error('caller failed'))).rejects.toBe(rowsFailure);

      expect(lifecycle(events)).toEqual([
        'A:started:statement',
        'A:ended:statement:failed',
        'A:finalized:statement:unknown',
      ]);
    });

    it('starts no activity when the caller stops before reading a row', async () => {
      const events: string[] = [];
      const iterator = queryStatement([recorder('A', events)], () => yieldRows([{ id: 1 }]))[
        Symbol.asyncIterator
      ]();

      await iterator.return?.();
      await iterator.return?.();
      await iterator.next();

      expect(events).toEqual([]);
    });
  });
});
