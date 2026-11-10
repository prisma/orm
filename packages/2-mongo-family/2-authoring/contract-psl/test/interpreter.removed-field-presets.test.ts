import {
  type AuthoringContributions,
  temporalTypeAliases,
} from '@internal/framework-components/authoring';
import { mongoCodecLookup, mongoDataTypeLookup } from '@internal/mongo-contract/test';
import { describe, expect, it } from 'vitest';
import { interpretMongoContract } from './interpreter-test-helpers';

const authoringContributions: AuthoringContributions = {
  type: { temporal: temporalTypeAliases({ codecId: 'mongo/date@1' }, 'a JavaScript Date') },
};

function diagnosticsOf(field: string, scalars: ReadonlyMap<string, string>) {
  const result = interpretMongoContract(
    `model Post {\n  id    ObjectId @id @map("_id")\n  value ${field}\n}\n`,
    {
      scalarTypes: scalars,
      defaultFunctionRegistry: new Map(),
      codecLookup: mongoCodecLookup,
      dataTypes: { entries: {}, lookup: mongoDataTypeLookup, dataTypeOfCodec: () => undefined },
      authoringContributions,
    },
  );
  return result.ok
    ? []
    : result.failure.diagnostics.map(({ code, message }) => ({ code, message }));
}

const scalars = new Map([
  ['ObjectId', 'mongo/objectId@1'],
  ['Date', 'mongo/date@1'],
]);

function removed(call: string, rewrite: string) {
  return [
    {
      code: 'PSL_UNRESOLVED_REFERENCE',
      message: `${call} was a field preset, and Prisma 8 removed field presets. ${rewrite}`,
    },
  ];
}

describe('a removed field preset in a Mongo schema', () => {
  it.each([
    ['temporal.createdAt()', 'Write temporal.CreatedAt.'],
    ['temporal.updatedAt()', 'Write temporal.UpdatedAt.'],
    [
      'temporal.timestamp(onCreate: now, onUpdate: now)',
      'Write Date @onCreate(now()) @onUpdate(now()).',
    ],
    ['temporal.timestamp(onUpdate: now)', 'Write Date @onUpdate(now()).'],
    ['temporal.timestamp(now)', 'Write Date @onCreate(now()).'],
    ['temporal.timestamp()', 'Write Date.'],
  ])('refuses %s with its rewrite', (call, rewrite) => {
    expect(diagnosticsOf(call, scalars)).toEqual(removed(call, rewrite));
  });

  it('names the rewrite without an argument the preset did not take', () => {
    expect(diagnosticsOf('temporal.timestamp(onUpdate: later)', scalars)).toEqual(
      removed(
        'temporal.timestamp(onUpdate: later)',
        'Write Date with @onCreate(now()) and @onUpdate(now()) for the phases the preset set.',
      ),
    );
  });

  it('keeps the binder message for a preset written without a call', () => {
    expect(diagnosticsOf('temporal.createdAt', scalars)).toEqual([
      { code: 'PSL_UNRESOLVED_REFERENCE', message: 'Cannot find type "temporal.createdAt"' },
    ]);
  });

  it('keeps the binder message for temporal.timestamp() when no scalar stores a date', () => {
    expect(
      diagnosticsOf('temporal.timestamp()', new Map([['ObjectId', 'mongo/objectId@1']])),
    ).toEqual([
      { code: 'PSL_UNRESOLVED_REFERENCE', message: 'Cannot find type "temporal.timestamp"' },
    ]);
  });
});
