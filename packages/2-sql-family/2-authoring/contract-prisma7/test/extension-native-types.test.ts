import type { Contract } from '@internal/contract/types';
import type { ControlExtensionDescriptor } from '@internal/framework-components/control';
import type { SqlStorage } from '@internal/sql-contract/types';
import { prisma7PostgresBinding } from '@internal/target-postgres/prisma7-binding';
import { describe, expect, it } from 'vitest';
import type { Prisma7TargetBinding } from '../src/target-binding';
import { interpretSchemaTextResult, serializedTable } from './support';

const shoutPack: ControlExtensionDescriptor<'sql', 'postgres'> = {
  kind: 'extension',
  id: 'shout',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  authoring: {
    type: {
      shout: {
        Shout: { kind: 'typeConstructor', output: { codecId: 'pg/xml@1' } },
      },
    },
  },
  create: () => ({ familyId: 'sql', targetId: 'postgres' }),
};

const binding: Prisma7TargetBinding = {
  ...prisma7PostgresBinding,
  typeMap: {
    ...prisma7PostgresBinding.typeMap,
    extensionNativeTypes: {
      Shout: { constructorPath: ['shout', 'Shout'], args: [], extension: 'shout_ext' },
    },
  },
  extensions: {
    ...prisma7PostgresBinding.extensions,
    packs: {
      shout_ext: { id: 'shout', importName: 'shout', importPath: '@example/shout/control' },
    },
  },
};

const schema = `datasource db {
  provider = "postgresql"
}

model Account {
  id    Int      @id
  name  String   @db.Shout
  names String[] @db.Shout
}
`;

function interpret(extensions: readonly ControlExtensionDescriptor<'sql', 'postgres'>[]) {
  return interpretSchemaTextResult(schema, binding, new Map(), undefined, extensions);
}

function contractOf(extensions: readonly ControlExtensionDescriptor<'sql', 'postgres'>[]) {
  const result = interpret(extensions);
  if (!result.ok) throw new Error(JSON.stringify(result.failure.diagnostics));
  return result.value as Contract<SqlStorage>;
}

describe('a native type an extension provides', () => {
  it('reads as the constructor of the composed pack that declares the extension', () => {
    const contract = contractOf([shoutPack]);
    expect(serializedTable(contract, 'Account').columns).toMatchObject({
      name: { codecId: 'pg/xml@1', nullable: false },
      names: { codecId: 'pg/xml@1', many: { elementNullable: true } },
    });
  });

  it('records the composed pack in the contract', () => {
    expect(contractOf([shoutPack]).extensions).toEqual({
      shout: {
        kind: 'extension',
        id: 'shout',
        familyId: 'sql',
        targetId: 'postgres',
        version: '0.0.1',
      },
    });
  });

  it('names the config edit when the pack is not composed', () => {
    const result = interpret([]);
    if (result.ok) throw new Error('expected the schema to be refused');
    const message =
      'native type "@db.Shout" is a column type of the "shout" extension pack, which is not available. Add the pack to extensions in prisma.config.ts: import shout from \'@example/shout/control\', then extensions: [shout].';
    expect(result.failure.diagnostics.map(({ code, message }) => ({ code, message }))).toEqual([
      { code: 'PSL.PRISMA7_EXTENSION_PACK_MISSING', message: `Field "Account.name": ${message}` },
      { code: 'PSL.PRISMA7_EXTENSION_PACK_MISSING', message: `Field "Account.names": ${message}` },
    ]);
  });

  it('is unsupported when no pack declares its extension', () => {
    const result = interpretSchemaTextResult(schema, {
      ...binding,
      extensions: { ...binding.extensions, packs: {} },
    });
    if (result.ok) throw new Error('expected the schema to be refused');
    expect(result.failure.diagnostics.map(({ code }) => code)).toEqual([
      'PSL.PRISMA7_NATIVE_TYPE_UNSUPPORTED',
      'PSL.PRISMA7_NATIVE_TYPE_UNSUPPORTED',
    ]);
  });
});
