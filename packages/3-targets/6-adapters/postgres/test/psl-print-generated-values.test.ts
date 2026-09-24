import {
  type AuthoringFieldNamespace,
  isAuthoringFieldPresetDescriptor,
} from '@internal/framework-components/authoring';
import { timeouts } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import {
  composePostgresStack,
  printAndReadBack,
  readPsl,
  serializedWithoutCapabilities,
} from './helpers/psl-print';

const stack = composePostgresStack();

/**
 * Every call the stack registers a PSL default function for, with a written range such as
 * `<2-255>` replaced by its lower bound.
 */
const defaultFunctionCalls = [...stack.controlMutationDefaults.defaultFunctionRegistry.values()]
  .flatMap((entry) => entry.usageSignatures ?? [])
  .map((usage) => usage.replace(/<(\d+)-\d+>/, '$1'));

/** Every `temporal.*` field preset the stack contributes, called with the now generator in each phase it takes. */
function temporalPresetCalls(namespace: AuthoringFieldNamespace): readonly string[] {
  const temporal = namespace['temporal'];
  if (temporal === undefined || isAuthoringFieldPresetDescriptor(temporal)) return [];
  return Object.entries(temporal).flatMap(([name, preset]) => {
    if (!isAuthoringFieldPresetDescriptor(preset)) return [];
    const phases = (preset.args ?? [])
      .map((arg) => arg.name)
      .filter((argName) => argName === 'onCreate' || argName === 'onUpdate')
      .map((argName) => `${argName}: now`);
    return [`temporal.${name}(${phases.join(', ')})`];
  });
}

async function roundTrip(field: string): Promise<void> {
  const authored = await readPsl(`// use prisma-8
model Widget {
  id    Int @id
  ${field}
}
`);
  const printed = await printAndReadBack(authored);

  expect(serializedWithoutCapabilities(printed)).toEqual(serializedWithoutCapabilities(authored));
}

describe('every generated value the stack reads prints as PSL that reads back', () => {
  it('finds the default functions and temporal presets', () => {
    expect(defaultFunctionCalls).toContain('uuid(7)');
    expect(temporalPresetCalls(stack.authoringContributions.field)).toContain(
      'temporal.timestamptz(onCreate: now, onUpdate: now)',
    );
  });

  it.each(defaultFunctionCalls)(
    '@default(%s)',
    async (call) => {
      const type = call.startsWith('autoincrement')
        ? 'Int'
        : call.startsWith('now')
          ? 'DateTime'
          : 'String';
      await roundTrip(`value ${type} @default(${call})`);
    },
    timeouts.pslRoundTrip,
  );

  it.each(temporalPresetCalls(stack.authoringContributions.field))(
    '%s',
    async (call) => {
      await roundTrip(`value ${call}`);
    },
    timeouts.pslRoundTrip,
  );
});
