import { AsyncIterableResult } from '@internal/framework-components/runtime';
import {
  type ActivitySourceTarget,
  activitySource,
  delegatingActivitySource,
} from './activity-handle';
import type { Runtime } from './sql-runtime';

/** The runtime members a client runs its work on, each on the runtime `getRuntime()` returns when the member is called. */
export type DelegatingRuntime = Pick<Runtime, 'query' | 'execute' | 'connection' | 'prepare'> &
  ActivitySourceTarget;

/**
 * Members that look up the runtime with `getRuntime()` when they are called. When the lookup throws, for example because the client is closed, the member reports the error through what it returns: a result rejects when it is read, and a promise rejects.
 */
export function delegatingRuntime(getRuntime: () => Runtime): DelegatingRuntime {
  return {
    query(plan, options) {
      let runtime: Runtime;
      try {
        runtime = getRuntime();
      } catch (error) {
        return AsyncIterableResult.rejected(error);
      }
      return runtime.query(plan, options);
    },
    async execute(plan, options) {
      return getRuntime().execute(plan, options);
    },
    async connection() {
      return getRuntime().connection();
    },
    async prepare(declaration, callback) {
      return getRuntime().prepare(declaration, callback);
    },
    [activitySource]: delegatingActivitySource(getRuntime),
  };
}
