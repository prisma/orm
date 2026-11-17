import { generateContractDts } from '@internal/emitter';
import { join } from 'pathe';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { sqlEmission } from '../src/index';
import { createEmitterTestContract as createContract } from './create-emitter-test-contract';

const REPO_ROOT = join(import.meta.dirname, '../../../../..');

const HAND_WRITTEN_TYPES_MODULES = [
  'packages/3-extensions/citext/src/generated-types.ts',
  'packages/3-extensions/paradedb/src/generated-types.ts',
  'packages/3-extensions/pgvector/src/generated-types.ts',
  'packages/3-extensions/postgis/src/generated-types.ts',
  'packages/3-extensions/supabase/src/contract/generated-types.ts',
  'packages/2-sql-family/4-lanes/sql-builder/test/fixtures/generated-types.ts',
  'packages/3-extensions/sql-orm-client/test/fixtures/generated-types.ts',
  'packages/3-targets/postgres/9-facade/test/fixtures/generated-types.ts',
  'test/integration/test/fixtures/generated-types.ts',
];

const TYPES_MODULE = 'types-module';

function namesTheEmitterImports(): string[] {
  const contract = createContract({
    valueObjects: {
      Address: {
        fields: {
          street: { nullable: false, many: false, type: { kind: 'scalar', codecId: 'pg/text@1' } },
        },
      },
    },
    storage: { tables: {} },
  });
  const dts = generateContractDts(
    contract,
    sqlEmission,
    [],
    { storageHash: 'storage', profileHash: 'profile' },
    TYPES_MODULE,
  );
  const statement = dts.match(new RegExp(`import type \\{([^}]*)\\} from '${TYPES_MODULE}';`));
  return (statement?.[1] ?? '')
    .split(',')
    .map((binding) => binding.trim().split(/\s+as\s+/)[0] ?? '')
    .filter((name) => name !== '')
    .sort();
}

function exportedNames(file: string): string[] {
  const absolute = join(REPO_ROOT, file);
  const program = ts.createProgram([absolute], {
    module: ts.ModuleKind.Preserve,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
  });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(absolute);
  const symbol = source === undefined ? undefined : checker.getSymbolAtLocation(source);
  return symbol === undefined ? [] : checker.getExportsOfModule(symbol).map((s) => s.name);
}

describe('the hand-written SQL types modules', () => {
  const names = namesTheEmitterImports();

  it('the emitter imports framework, family and value object types from the types module', () => {
    expect(names).toEqual(
      expect.arrayContaining(['Contract', 'ContractWithTypeMaps', 'ValueObjectTypesFromStorage']),
    );
  });

  it.each(HAND_WRITTEN_TYPES_MODULES)('%s exports every name the emitter imports', (file) => {
    const exported = new Set(exportedNames(file));
    expect(names.filter((name) => !exported.has(name))).toEqual([]);
  });
});
