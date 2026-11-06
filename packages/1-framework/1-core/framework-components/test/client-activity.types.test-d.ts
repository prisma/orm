import { expectTypeOf, test } from 'vitest';
import type { ClientActivityRun } from '../src/execution/client-activity';
import type {
  Activity,
  ActivityEndedResult,
  ClientActivity,
  ClientActivityEnded,
  ClientActivityKind,
  ClientActivityResult,
  CrossFamilyMiddleware,
  RuntimeMiddleware,
  StatementActivity,
  TransactionActivity,
} from '../src/execution/runtime-middleware';
import { startCall } from './client-activity-fixtures';

test('Activity always includes client activities, registered or not', () => {
  expectTypeOf<Activity>().toEqualTypeOf<
    StatementActivity | TransactionActivity | ClientActivity
  >();
  expectTypeOf<ActivityEndedResult>().toExtend<unknown>();
  expectTypeOf<ClientActivityEnded>().toExtend<ActivityEndedResult>();
});

test('a client kind contains a hyphen, so statement and transaction are not client kinds', () => {
  expectTypeOf<'orm-call'>().toExtend<ClientActivityKind>();
  expectTypeOf<'unregistered-call'>().toExtend<ClientActivityKind>();
  expectTypeOf<'statement'>().not.toExtend<ClientActivityKind>();
  expectTypeOf<'transaction'>().not.toExtend<ClientActivityKind>();
});

test('narrowing on statement, transaction and a client kind', () => {
  const middleware: CrossFamilyMiddleware = {
    name: 'narrowing',
    async activityStarted(activity) {
      if (activity.kind === 'statement') {
        expectTypeOf(activity).toEqualTypeOf<StatementActivity>();
        return;
      }
      expectTypeOf(activity).toEqualTypeOf<TransactionActivity | ClientActivity>();
      if (activity.kind === 'transaction') {
        expectTypeOf(activity).toEqualTypeOf<TransactionActivity>();
        return;
      }
      expectTypeOf(activity.contentHash).toEqualTypeOf<() => Promise<string>>();
    },
  };
  void middleware;
});

test('an unregistered kind reaches the hooks with an unknown result', () => {
  const middleware: CrossFamilyMiddleware = {
    name: 'unregistered',
    intercept: {
      async onActivity(activity) {
        expectTypeOf(activity.kind).toEqualTypeOf<ClientActivityKind>();
        return undefined;
      },
    },
    async activityEnded(_activity, result) {
      if (result.kind === 'statement' || result.kind === 'transaction') return;
      expectTypeOf(result.result).toEqualTypeOf<unknown>();
      expectTypeOf(result.source).toEqualTypeOf<'client' | 'middleware'>();
      expectTypeOf(result.outcome).toEqualTypeOf<'succeeded' | 'failed' | 'stopped'>();
    },
  };
  void middleware;
  expectTypeOf<ClientActivityResult<'unregistered-call'>>().toEqualTypeOf<unknown>();
});

test('a registered kind gets its result type', async () => {
  expectTypeOf<ClientActivityResult<'test-count'>>().toEqualTypeOf<number>();
  const call = await startCall([], { kind: 'test-count' });
  expectTypeOf(call).toEqualTypeOf<ClientActivityRun<'test-count'>>();
  expectTypeOf(call.activity).toEqualTypeOf<ClientActivity<'test-count'>>();
  expectTypeOf(call.intercepted).toEqualTypeOf<{ readonly result: number } | undefined>();
  // @ts-expect-error - a test-count activity ends with a number
  await call.end({ outcome: 'succeeded', result: 'not a number' });
});

test('startClientActivity does not accept the reserved kinds', () => {
  // @ts-expect-error - statement is not a client kind
  void startCall([], { kind: 'statement' });
});

test('intercept.onActivity receives a client activity and returns an opaque result', () => {
  type OnActivity = NonNullable<NonNullable<RuntimeMiddleware['intercept']>['onActivity']>;
  expectTypeOf<Parameters<OnActivity>[0]>().toEqualTypeOf<ClientActivity>();
  expectTypeOf<ReturnType<OnActivity>>().toEqualTypeOf<
    Promise<{ readonly result: unknown } | undefined>
  >();
});
