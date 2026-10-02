import type {
  AuthoringContributions,
  DataTypeSupport,
} from '@internal/framework-components/authoring';
import type { BlockSpecContext, PslBlockSpecDescriptor } from '@internal/psl-parser';
import { blockAttribute, optional, str, structBlock } from '@internal/psl-parser';
import { hasPslInterpreter } from '@internal/psl-parser/interpret';
import { bindPslSchema } from '@internal/psl-parser/test';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { prismaContract } from '../src/exports/provider';
import { fixtureDataTypeSupport } from './fixture-data-types';
import {
  createPostgresTestContext,
  interpretSqlContract,
  postgresScalarTypeDescriptors,
  postgresTarget,
} from './fixtures';

const SCHEMA = `// use prisma-8
audit_rule Reads {
  note = "reads"
  @@map("reads")
}
`;

function recordingContributions(seen: BlockSpecContext[]): AuthoringContributions {
  const descriptor = {
    kind: 'pslBlock',
    keyword: 'audit_rule',
    discriminator: 'audit_rule',
    name: { required: true },
    spec: (ctx: BlockSpecContext) => {
      seen.push(ctx);
      return structBlock({
        parameters: { note: { type: optional(str()), documentation: 'A note.' } },
      });
    },
    attributes: {
      map: (ctx: BlockSpecContext) => {
        seen.push(ctx);
        return blockAttribute('map', {
          documentation: 'Maps the rule.',
          positional: [{ key: 'name', type: str(), documentation: 'The rule name.' }],
        });
      },
    },
  } satisfies PslBlockSpecDescriptor;
  return {
    entityTypes: {
      audit_rule: {
        kind: 'entity',
        discriminator: 'audit_rule',
        output: { factory: (raw: unknown) => raw },
      },
    },
    pslBlockDescriptors: { audit_rule: descriptor },
  };
}

function stackDataTypes(): DataTypeSupport {
  return { entries: fixtureDataTypeSupport.entries, lookup: fixtureDataTypeSupport.lookup };
}

describe('block spec context', () => {
  it('receives the data types the SQL interpreter is given', () => {
    const seen: BlockSpecContext[] = [];
    const dataTypes = stackDataTypes();

    const result = interpretSqlContract(SCHEMA, {
      target: postgresTarget,
      scalarColumnDescriptors: postgresScalarTypeDescriptors,
      composedExtensionContracts: new Map(),
      createNamespace: createTestSqlNamespace,
      dataTypes,
      capabilities: { sql: { scalarList: true } },
      authoringContributions: recordingContributions(seen),
    });

    expect(result.ok).toBe(true);
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(seen.filter((ctx) => ctx.dataTypes !== dataTypes)).toEqual([]);
  });

  it("receives the stack's data types through the SQL provider", () => {
    const seen: BlockSpecContext[] = [];
    const { entityTypes, pslBlockDescriptors } = recordingContributions(seen);
    const base = createPostgresTestContext();
    const context = createPostgresTestContext({
      dataTypes: stackDataTypes(),
      authoringContributions: {
        ...base.authoringContributions,
        entityTypes: entityTypes ?? {},
        pslBlockDescriptors: pslBlockDescriptors ?? {},
      },
    });
    const source = prismaContract('./schema.prisma', {
      target: postgresTarget,
      createNamespace: createTestSqlNamespace,
    }).source;
    if (!hasPslInterpreter(source)) throw new Error('expected an interpret-capable source');

    const result = source.interpret(
      bindPslSchema(SCHEMA, { sourceId: 'schema.prisma', context }),
      context,
    );

    expect(result.ok).toBe(true);
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(seen.filter((ctx) => ctx.dataTypes !== context.dataTypes)).toEqual([]);
  });
});
