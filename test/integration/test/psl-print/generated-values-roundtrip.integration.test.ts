import {
  type AuthoringTypeNamespace,
  isAuthoringTypeAliasDescriptor,
  isAuthoringTypeConstructorDescriptor,
} from '@internal/framework-components/authoring';
import { timeouts } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { extensions as slugidExtensions } from '../authoring/parity/default-pack-slugid/packs';
import {
  composePostgresStack,
  type PostgresStack,
  printAndReadBack,
  printContract,
  readPsl,
  serializedWithoutCapabilities,
} from './print-and-read-back';

const stack = composePostgresStack();

/**
 * Every call the stack registers a PSL default function for, with a written range such as
 * `<2-255>` replaced by its lower bound.
 */
const defaultFunctionCalls = [...stack.controlMutationDefaults.defaultFunctionRegistry.values()]
  .flatMap((entry) => entry.usageSignatures ?? [])
  .map((usage) => usage.replace(/<(\d+)-\d+>/, '$1'));

/** A call of every generator function the stack binds to `String`, with each argument form. */
const textGeneratorCalls = [
  'uuid()',
  'uuid(7)',
  'cuid(2)',
  'ulid()',
  'nanoid()',
  'nanoid(2)',
  'ksuid()',
];

/** Every `temporal.*` type alias the stack contributes. */
function temporalTypeAliases(types: AuthoringTypeNamespace): readonly string[] {
  const temporal = types['temporal'];
  if (temporal === undefined || isAuthoringTypeConstructorDescriptor(temporal)) return [];
  return Object.entries(temporal).flatMap(([name, alias]) =>
    isAuthoringTypeAliasDescriptor(alias) ? [`temporal.${name}`] : [],
  );
}

/** Every type the stack's `now()` generates a value for, written with no arguments and both generator attributes. */
function nowGeneratedTypes(withStack: PostgresStack): readonly string[] {
  return Object.entries(withStack.authoringContributions.type).flatMap(([name, descriptor]) =>
    isAuthoringTypeConstructorDescriptor(descriptor) &&
    descriptor.entityRefArg === undefined &&
    (descriptor.args ?? []).every((arg) => arg.optional === true) &&
    withStack.generatorFunctions
      .functionsFor(descriptor.output.codecId)
      .some((fn) => fn.name === 'now')
      ? [`${name} @onCreate(now()) @onUpdate(now())`]
      : [],
  );
}

async function roundTrip(field: string, withStack: PostgresStack = stack): Promise<void> {
  const authored = await readPsl(
    `// use prisma-8
model Widget {
  id    Int @id
  ${field}
}
`,
    { stack: withStack },
  );
  const printed = await printAndReadBack(authored, { stack: withStack });

  expect(serializedWithoutCapabilities(printed)).toEqual(serializedWithoutCapabilities(authored));
}

describe('every generated value the stack reads prints as PSL that reads back', () => {
  it('finds the default functions, generator functions, temporal aliases and now() types', () => {
    expect(defaultFunctionCalls).toContain('now()');
    expect(stack.generatorFunctions.functionsFor('pg/text@1').map(({ name }) => name)).toEqual(
      [...new Set(textGeneratorCalls.map((call) => call.slice(0, call.indexOf('('))))].sort(),
    );
    expect({
      aliases: temporalTypeAliases(stack.authoringContributions.type),
      now: nowGeneratedTypes(stack),
    }).toMatchObject({
      aliases: expect.arrayContaining(['temporal.CreatedAt', 'temporal.UpdatedAt']),
      now: expect.arrayContaining(['TimestamptzTemporal @onCreate(now()) @onUpdate(now())']),
    });
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

  it.each(textGeneratorCalls)(
    '@onCreate(%s)',
    async (call) => {
      await roundTrip(`value String @onCreate(${call})`);
    },
    timeouts.pslRoundTrip,
  );

  it(
    '@onCreate(now()) @onUpdate(now()) beside @default(now())',
    async () => {
      await roundTrip('value DateTime @default(now()) @onCreate(now()) @onUpdate(now())');
    },
    timeouts.pslRoundTrip,
  );

  it.each([...temporalTypeAliases(stack.authoringContributions.type), ...nowGeneratedTypes(stack)])(
    '%s',
    async (call) => {
      await roundTrip(`value ${call}`);
    },
    timeouts.pslRoundTrip,
  );

  it(
    'a default function an extension registers',
    async () => {
      await roundTrip(
        'value String @onCreate(slugid())',
        composePostgresStack([...slugidExtensions]),
      );
    },
    timeouts.pslRoundTrip,
  );

  it(
    'the generated columns of the slice example, on VarChar(32) and Time(3) among them',
    async () => {
      const authored = await readPsl(`// use prisma-8
model Event {
  id        String      @id @onCreate(uuid(7))
  code      VarChar(32) @onCreate(nanoid())
  seenAt    TimeTemporal(3)     @onUpdate(now())
  createdAt TimestamptzTemporal    @default(now()) @onCreate(now())
}
`);
      const fieldLines = printContract(authored)
        .text.split('\n')
        .map((line) => line.trim().replace(/\s+/g, ' '))
        .filter((line) => /^(id|code|seenAt|createdAt) /.test(line));
      const printed = await printAndReadBack(authored);

      expect({
        defaults: authored.execution?.mutations.defaults,
        fieldLines,
        roundTrip: serializedWithoutCapabilities(printed),
      }).toEqual({
        defaults: [
          {
            ref: { namespace: 'public', entry: 'Event', field: 'code' },
            onCreate: { kind: 'generator', id: 'nanoid' },
          },
          {
            ref: { namespace: 'public', entry: 'Event', field: 'createdAt' },
            onCreate: { kind: 'generator', id: 'instantNow' },
          },
          {
            ref: { namespace: 'public', entry: 'Event', field: 'id' },
            onCreate: { kind: 'generator', id: 'uuidv7' },
          },
          {
            ref: { namespace: 'public', entry: 'Event', field: 'seenAt' },
            onUpdate: { kind: 'generator', id: 'plainTimeNow', params: { precision: 3 } },
          },
        ],
        fieldLines: [
          'id String @id @onCreate(uuid(7))',
          'code VarChar(32) @onCreate(nanoid())',
          'seenAt Time(as: temporal, precision: 3) @onUpdate(now())',
          'createdAt DateTime(as: temporal) @default(now()) @onCreate(now())',
        ],
        roundTrip: serializedWithoutCapabilities(authored),
      });
    },
    timeouts.pslRoundTrip,
  );
});
