import { soleDomainNamespaceId } from '@internal/contract/types';
import type {
  ClientActivity,
  ClientActivityEnd,
  ClientActivityKind,
  StartActivity,
} from '@internal/framework-components/runtime';
import type { SqlStatementStats } from '@internal/sql-relational-core/ast';
import type { SqlExecutionPlan, SqlQueryPlan } from '@internal/sql-relational-core/plan';
import type { ExecutionContext } from '@internal/sql-relational-core/query-lane-context';
import {
  type ActivityHandle,
  type ActivitySource,
  activitySource,
  type HashablePlan,
  type RuntimeTransaction,
} from '@internal/sql-runtime';
import { canonicalStringify } from '@internal/utils/canonical-stringify';
import { hashContent } from '@internal/utils/hash-content';
import { Collection } from '../src/collection';
import { type TestModelName, withReturningCapability } from './collection-fixtures';
import { createMockRuntime, getTestContext, type MockRuntime, type TestContract } from './helpers';

type AnyPlan = SqlExecutionPlan<unknown> | SqlQueryPlan<unknown>;

export interface RecordedCall {
  readonly activity: ClientActivity;
  readonly statements: AnyPlan[];
  readonly transactions: Array<'open' | 'committed' | 'rolled-back'>;
  ended: ClientActivityEnd<ClientActivityKind> | undefined;
}

export interface ActivityRuntimeOptions {
  /** Supplies a result for a call, as an `intercept.onActivity` handler does. */
  readonly intercept?: (activity: ClientActivity) => { readonly result: unknown } | undefined;
  /** Opens calls without `transaction()`, as a handle opened inside a transaction is. */
  readonly insideTransaction?: boolean;
  /** Makes `end` record the end and then reject, as the runtime does when a child is still open. */
  readonly endRejects?: Error;
}

export const fakePlanHash = 'plan-hash';

function once(compute: () => Promise<string>): () => Promise<string> {
  let computed: Promise<string> | undefined;
  return () => {
    computed ??= compute();
    return computed;
  };
}

/** A mock runtime that records the `orm-call` activities started on it, the statements sent through each and how each ended. */
export function createActivityRuntime(options: ActivityRuntimeOptions = {}): {
  runtime: MockRuntime;
  calls: RecordedCall[];
  hashed: HashablePlan[];
  outside: AnyPlan[];
} {
  const runtime = createMockRuntime();
  const calls: RecordedCall[] = [];
  const hashed: HashablePlan[] = [];
  const outside: AnyPlan[] = [];
  const rootQuery = runtime.query.bind(runtime);
  const rootExecute = runtime.execute.bind(runtime);

  const recordingScope = (statements: AnyPlan[]) => ({
    query: <Row>(plan: AnyPlan) => {
      statements.push(plan);
      return rootQuery<Row>(plan as SqlQueryPlan<Row>);
    },
    execute: (plan: AnyPlan): Promise<SqlStatementStats> => {
      statements.push(plan);
      return rootExecute(plan);
    },
  });

  const source: ActivitySource = {
    async startActivity<K extends ClientActivityKind>(
      start: StartActivity<K>,
    ): Promise<ActivityHandle<K>> {
      const activity: ClientActivity<K> = {
        id: `call-${calls.length + 1}`,
        kind: start.kind,
        contentHash: once(start.contentHash),
        annotations: start.annotations ?? new Map(),
      };
      const call: RecordedCall = { activity, statements: [], transactions: [], ended: undefined };
      calls.push(call);
      const transaction = async (): Promise<RuntimeTransaction> => {
        const index = call.transactions.push('open') - 1;
        return {
          ...recordingScope(call.statements),
          commit: async () => {
            call.transactions[index] = 'committed';
          },
          rollback: async () => {
            call.transactions[index] = 'rolled-back';
          },
        };
      };
      const handle = {
        ...recordingScope(call.statements),
        activity,
        intercepted: options.intercept?.(activity),
        ...(options.insideTransaction ? {} : { transaction }),
        startActivity: source.startActivity,
        planContentHash: source.planContentHash,
        [activitySource]: source,
        async end(end: ClientActivityEnd<K>) {
          if (call.ended !== undefined) throw new Error('ended twice');
          call.ended = end;
          if (options.endRejects) throw options.endRejects;
        },
      };
      return handle as unknown as ActivityHandle<K>;
    },
    async planContentHash(subject) {
      hashed.push(subject);
      return fakePlanHash;
    },
  };

  Object.assign(runtime, {
    query: <Row>(plan: AnyPlan) => {
      outside.push(plan);
      return rootQuery<Row>(plan as SqlQueryPlan<Row>);
    },
    execute: (plan: AnyPlan) => {
      outside.push(plan);
      return rootExecute(plan);
    },
    [activitySource]: source,
  });

  return { runtime, calls, hashed, outside };
}

/** The content hash an `orm-call` for `method` has when its hash input is `hashInput`. */
export function ormCallHash(method: string, hashInput: unknown): Promise<string> {
  return hashContent(canonicalStringify({ kind: 'orm-call', method, hashInput }));
}

/** A collection over {@link createActivityRuntime}; with `returning`, over a contract that has the returning capability, as writes need. */
export function createActivityCollectionFor<ModelName extends TestModelName>(
  modelName: ModelName,
  options: ActivityRuntimeOptions & { readonly returning?: boolean } = {},
) {
  const recorded = createActivityRuntime(options);
  const base = getTestContext();
  const context = options.returning
    ? ({ ...base, contract: withReturningCapability() } as ExecutionContext<TestContract>)
    : base;
  const collection = new Collection({ runtime: recorded.runtime, context }, modelName, {
    namespaceId: soleDomainNamespaceId(context.contract.domain),
  });
  return { collection, ...recorded };
}

/** The namespaces of the branded annotations on the plans of every statement the runtime received. */
export function statementAnnotationNamespaces(runtime: MockRuntime): string[] {
  return runtime.executions.flatMap(({ plan }) =>
    Object.entries(plan.meta.annotations ?? {})
      .filter(([, value]) => (value as { __annotation?: unknown } | null)?.__annotation === true)
      .map(([namespace]) => namespace),
  );
}
