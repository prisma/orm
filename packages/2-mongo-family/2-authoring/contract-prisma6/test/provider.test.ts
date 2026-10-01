import { computeExecutionHash } from '@internal/contract/hashing';
import type { Codec, CodecLookupWithDescriptors } from '@internal/framework-components/codec';
import { prisma6MongoBinding } from '@internal/target-mongo/prisma6-binding';
import { structuredError } from '@internal/utils/structured-error';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { prisma6Contract } from '../src/provider';
import { fixturesDir, mongoSourceContext, mongoStack } from './support';

const enumSchema = join(fixturesDir, 'enums', 'schema.prisma');

function lookupWithFailingEncode(codecId: string, failure: Error): CodecLookupWithDescriptors {
  const base = mongoStack.codecLookup;
  return {
    ...base,
    get: (id) => {
      const codec = base.get(id);
      if (id !== codecId || codec === undefined) return codec;
      return Object.assign(Object.create(codec) as Codec, {
        encodeJson: () => {
          throw failure;
        },
      });
    },
    targetTypesFor: (id) => base.targetTypesFor(id),
    renderOutputTypeFor: (id, params) => base.renderOutputTypeFor(id, params),
  };
}

function loadEnumSchema(codecLookup: CodecLookupWithDescriptors) {
  return prisma6Contract('enums/schema.prisma', { binding: prisma6MongoBinding }).source.load({
    ...mongoSourceContext([enumSchema]),
    codecLookup,
  });
}

function loadFixture(caseName: string) {
  const schemaPath = join(fixturesDir, caseName, 'schema.prisma');
  return prisma6Contract(`${caseName}/schema.prisma`, { binding: prisma6MongoBinding }).source.load(
    mongoSourceContext([schemaPath]),
  );
}

describe('prisma6Contract', () => {
  it('has only the fields every contract source can declare: format, inputs, parser options and a loader', () => {
    const { source } = prisma6Contract('prisma/schema.prisma', { binding: prisma6MongoBinding });

    expect(Object.keys(source).sort()).toEqual(['format', 'inputs', 'load', 'parserOptions']);
    expect(source).toMatchObject({
      format: 'psl',
      inputs: ['prisma/schema.prisma'],
      parserOptions: { grammar: 'prisma-7' },
    });
  });
});

describe('prisma6Contract diagnostics', () => {
  it('lists findings in source order', async () => {
    const result = await loadFixture('unknown-attribute');
    if (result.ok) throw new Error('Expected the load to fail');
    expect(result.failure.diagnostics.map((diagnostic) => diagnostic.span?.start.line)).toEqual([
      8, 11,
    ]);
  });

  it('says there is no file at a mistyped path and where the path is set', async () => {
    const missing = join(fixturesDir, 'no-such-case', 'schema.prisma');
    const result = await prisma6Contract('prisma/schem.prisma', {
      binding: prisma6MongoBinding,
    }).source.load(mongoSourceContext([missing]));
    if (result.ok) throw new Error('Expected the load to fail');
    expect(result.failure.diagnostics).toEqual([
      {
        code: 'PSL.PRISMA6_MONGO_SCHEMA_READ_FAILED',
        message:
          'There is no file or directory at "prisma/schem.prisma". Fix the path passed to prisma6Schema() in prisma.config.ts.',
        sourceId: 'prisma/schem.prisma',
      },
    ]);
  });
});

describe('prisma6Contract', () => {
  it('declares the prisma-7 grammar', () => {
    expect(
      prisma6Contract('prisma/schema.prisma', { binding: prisma6MongoBinding }).source,
    ).toMatchObject({ format: 'psl', parserOptions: { grammar: 'prisma-7' } });
  });

  it('reports a structured error from building the contract as PSL.PRISMA6_MONGO_CONTRACT_INVALID', async () => {
    const failure = structuredError('CONTRACT.TEST_FAILURE', 'Enum value cannot be encoded.');
    const result = await loadEnumSchema(lookupWithFailingEncode('mongo/string@1', failure));
    if (result.ok) throw new Error('Expected the load to fail');
    expect(result.failure).toEqual({
      summary: 'Prisma 6 MongoDB schema interpretation failed',
      diagnostics: [
        {
          code: 'PSL.PRISMA6_MONGO_CONTRACT_INVALID',
          message:
            'This schema gives a contract that Prisma 8 rejects, and the Prisma 6 MongoDB contract source has no specific diagnostic for the cause: Enum value cannot be encoded. This is a bug in Prisma ORM; please report it with this schema.',
          sourceId: 'enums/schema.prisma',
        },
      ],
      meta: { schemaPath: 'enums/schema.prisma', code: 'CONTRACT.TEST_FAILURE' },
    });
  });

  it('lets an error that is not structured propagate', async () => {
    const failure = new TypeError('codec bug');
    await expect(loadEnumSchema(lookupWithFailingEncode('mongo/string@1', failure))).rejects.toBe(
      failure,
    );
  });

  it('hashes the execution section for the target the binding names', async () => {
    const timestampsSchema = join(fixturesDir, 'timestamps', 'schema.prisma');
    const binding = {
      ...prisma6MongoBinding,
      target: { ...prisma6MongoBinding.target, targetId: 'mongo-other' },
    };
    const result = await prisma6Contract('timestamps/schema.prisma', { binding }).source.load(
      mongoSourceContext([timestampsSchema]),
    );
    if (!result.ok) throw new Error('Expected the load to succeed');
    const contract = result.value;
    expect(contract.target).toBe('mongo-other');
    expect(contract.execution?.executionHash).toBe(
      computeExecutionHash({
        target: 'mongo-other',
        targetFamily: 'mongo',
        execution: { mutations: { defaults: contract.execution?.mutations.defaults ?? [] } },
      }),
    );
  });
});
