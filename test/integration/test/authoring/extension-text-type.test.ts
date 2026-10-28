import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import postgresAdapter from '@internal/adapter-postgres/control';
import type { SqlControlExtensionDescriptor } from '@internal/family-sql/control';
import sql from '@internal/family-sql/control';
import type { AuthoringTypeNamespace } from '@internal/framework-components/authoring';
import {
  type AnyCodecDescriptor,
  type CodecCallContext,
  CodecImpl,
  type CodecInstanceContext,
  type DataTypeValue,
  readJsonString,
} from '@internal/framework-components/codec';
import { createControlStack } from '@internal/framework-components/control';
import { sqlDataType } from '@internal/sql-contract/data-type';
import { prismaContract } from '@internal/sql-contract-psl/provider';
import type { ProjectionExpr } from '@internal/sql-relational-core/ast';
import {
  definePostgresCodecs,
  PostgresCodecDescriptor,
} from '@internal/target-postgres/codec-descriptor';
import postgres from '@internal/target-postgres/control';
import { pgText } from '@internal/target-postgres/data-types';
import postgresPackRef from '@internal/target-postgres/pack';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { join } from 'pathe';
import { afterAll, describe, expect, it } from 'vitest';

const CITEXT_CODEC_ID = 'testtext/citext@1' as const;

/** A text data type an extension adds, which takes a quoted string through a cast from `pg/text`. */
const testtextCitext = sqlDataType('testtext/citext', {
  texts: [{ text: 'citext', written: true, catalog: true }],
  read: (json) => readJsonString('testtext/citext', json),
  casts: { [pgText.id]: (value) => value },
});

class CitextCodec extends CodecImpl<typeof CITEXT_CODEC_ID, readonly [], string, string> {
  constructor(descriptor: AnyCodecDescriptor) {
    super(descriptor, testtextCitext, {});
  }

  async toWire(value: string, _ctx: CodecCallContext): Promise<string> {
    return value;
  }

  async fromWire(wire: string, _ctx: CodecCallContext): Promise<string> {
    return wire;
  }

  fromDataTypeValue(value: DataTypeValue<string>): string {
    return value.value;
  }

  toDataTypeValue(input: string): DataTypeValue {
    return this.dataTypeValueOf(input);
  }
}

class CitextDescriptor extends PostgresCodecDescriptor<Record<string, never>> {
  override readonly jsonType = 'any' as const;
  override readonly dataType = testtextCitext.id;
  override readonly codecId = CITEXT_CODEC_ID;
  override readonly traits = ['equality'] as const;
  override readonly paramsSchema = undefined;
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return expression;
  }
  override factory(): (ctx: CodecInstanceContext) => CitextCodec {
    return () => new CitextCodec(this);
  }
}

const testtext: SqlControlExtensionDescriptor<'postgres'> = {
  kind: 'extension',
  id: 'testtext',
  version: '0.0.1',
  familyId: 'sql',
  targetId: 'postgres',
  authoring: {
    type: {
      testtext: { Citext: { kind: 'typeConstructor', output: { codecId: CITEXT_CODEC_ID } } },
    } satisfies AuthoringTypeNamespace,
    textDataTypes: [testtextCitext.id],
  },
  dataTypes: [testtextCitext],
  types: { codecTypes: { codecDescriptors: definePostgresCodecs([new CitextDescriptor()]) } },
  create() {
    return { familyId: 'sql', targetId: 'postgres' };
  },
};

const stack = createControlStack({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  extensions: [testtext],
});

const folders: string[] = [];
afterAll(() => {
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

async function author(schema: string) {
  const folder = mkdtempSync(join(tmpdir(), 'psl-extension-text-type-'));
  folders.push(folder);
  const schemaPath = join(folder, 'schema.prisma');
  writeFileSync(schemaPath, `// use prisma-8\n\n${schema}`, 'utf-8');
  const result = await prismaContract(schemaPath, {
    target: postgresPackRef,
    createNamespace: postgresCreateNamespace,
  }).source.load({
    composedExtensions: ['testtext'],
    defaultNamespaceId: stack.target.defaultNamespaceId,
    composedExtensionContracts: new Map(),
    authoringContributions: stack.authoringContributions,
    codecLookup: stack.codecLookup,
    dataTypes: stack.dataTypes,
    controlMutationDefaults: stack.controlMutationDefaults,
    generatorFunctions: stack.generatorFunctions,
    resolvedInputs: [schemaPath],
    capabilities: stack.capabilities,
  });
  if (!result.ok) throw new Error(JSON.stringify(result.failure.diagnostics));
  return result.value;
}

describe('the text data types of a target', () => {
  it('are named by the target, not its adapter', () => {
    expect({
      target: postgres.authoring?.textDataTypes,
      adapter: postgresAdapter.authoring?.textDataTypes,
    }).toEqual({ target: ['pg/text', 'pg/char', 'pg/varchar'], adapter: undefined });
  });
});

describe('a text data type an extension names in textDataTypes', () => {
  it('is a discriminator column', async () => {
    const contract = await author(`model Shape {
  id   Int @id
  kind testtext.Citext

  @@discriminator(kind)
}

model Circle {
  radius Int?

  @@base(Shape, "circle")
}
`);
    expect(contract.domain.namespaces['public']?.models['Shape']?.variants).toEqual({
      circle: { model: 'Circle', namespace: 'public' },
    });
  });
});
