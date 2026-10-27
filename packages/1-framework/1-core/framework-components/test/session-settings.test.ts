import { describe, expect, it } from 'vitest';
import type { ControlDriverConnectOptions } from '../src/control/control-descriptors';
import { type CreateControlStackInput, createControlStack } from '../src/control/control-stack';
import type {
  RuntimeAdapterDescriptor,
  RuntimeDriverDescriptor,
  RuntimeTargetDescriptor,
} from '../src/execution/execution-descriptors';
import { createExecutionStack, instantiateExecutionStack } from '../src/execution/execution-stack';
import type { SessionSettings } from '../src/shared/framework-components';

const SETTINGS: SessionSettings = { ReadStyle: 'plain' };

function runtimeTarget(sessionSettings?: SessionSettings): RuntimeTargetDescriptor<'sql', 'demo'> {
  return {
    kind: 'target',
    id: 'demo',
    familyId: 'sql',
    targetId: 'demo',
    version: '0.0.1',
    ...(sessionSettings === undefined ? {} : { sessionSettings }),
    create: () => ({ familyId: 'sql', targetId: 'demo' }),
  };
}

const adapter: RuntimeAdapterDescriptor<'sql', 'demo'> = {
  kind: 'adapter',
  id: 'demo-adapter',
  familyId: 'sql',
  targetId: 'demo',
  version: '0.0.1',
  create: () => ({ familyId: 'sql', targetId: 'demo' }),
};

function recordingRuntimeDriver() {
  const calls: unknown[][] = [];
  const driver: RuntimeDriverDescriptor<'sql', 'demo', { readonly batch: number }> = {
    kind: 'driver',
    id: 'demo-driver',
    familyId: 'sql',
    targetId: 'demo',
    version: '0.0.1',
    create: (...args: unknown[]) => {
      calls.push(args);
      return { familyId: 'sql', targetId: 'demo' };
    },
  };
  return { driver, calls };
}

describe('the session settings a target declares', () => {
  it('reach every runtime driver the stack creates, with the options the caller gives', () => {
    const { driver, calls } = recordingRuntimeDriver();
    const stack = createExecutionStack({ target: runtimeTarget(SETTINGS), adapter, driver });

    stack.driver?.create({ batch: 5 });
    instantiateExecutionStack(stack);

    expect(calls).toEqual([
      [{ batch: 5 }, SETTINGS],
      [undefined, SETTINGS],
    ]);
  });

  it('leave the runtime driver as it is when the target declares none', () => {
    const { driver } = recordingRuntimeDriver();
    expect(createExecutionStack({ target: runtimeTarget(), adapter, driver }).driver).toBe(driver);
  });

  it('reach every control driver the stack creates, beside the connect options the caller gives', async () => {
    const calls: unknown[][] = [];
    const input = {
      family: { kind: 'family', id: 'sql', version: '0.0.1' },
      target: { kind: 'target', id: 'demo', version: '0.0.1', sessionSettings: SETTINGS },
      driver: {
        kind: 'driver',
        id: 'demo-driver',
        familyId: 'sql',
        targetId: 'demo',
        version: '0.0.1',
        create: async (url: string, options?: ControlDriverConnectOptions) => {
          calls.push([url, options]);
          return {};
        },
      },
    } as unknown as CreateControlStackInput<'sql', 'demo'>;

    const stack = createControlStack(input);
    await stack.driver?.create('postgres://example', { connectTimeoutMs: 5 });

    expect(calls).toEqual([
      ['postgres://example', { connectTimeoutMs: 5, sessionSettings: SETTINGS }],
    ]);
  });
});
