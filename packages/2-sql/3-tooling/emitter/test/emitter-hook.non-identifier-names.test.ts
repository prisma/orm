import { generateContractDts } from '@internal/emitter';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { sqlEmission } from '../src/index';
import { createEmitterTestContract as createContract } from './create-emitter-test-contract';
import { identityCodecLookup } from './value-set-codec-lookups';

const testHashes = { storageHash: 'test-core-hash', profileHash: 'test-profile-hash' };

const SPACED_NAMESPACE = 'report data';
const SPACED_TABLE = 'data rows';
const SPACED_COLUMN = 'has space';
const SPACED_TYPE = 'my type';

/**
 * Mirrors the reproduction in https://github.com/prisma/prisma-next/issues/981: `@map` / `@@schema` accept
 * physical names that are legal quoted SQL identifiers but not bare TS
 * identifiers, and each one reaches `contract.d.ts` as a property key.
 */
function contractWithNonIdentifierNames() {
  return createContract({
    domain: {
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: {
          models: {
            DataRow: {
              storage: {
                namespaceId: SPACED_NAMESPACE,
                table: SPACED_TABLE,
                fields: { id: { column: 'id' }, spacedValue: { column: SPACED_COLUMN } },
              },
              fields: {
                id: {
                  nullable: false,
                  many: false,
                  type: { kind: 'scalar', codecId: 'pg/int4@1' },
                },
                spacedValue: {
                  nullable: true,
                  many: false,
                  type: { kind: 'scalar', codecId: 'pg/text@1' },
                },
              },
              relations: {},
            },
          },
        },
      },
    },
    storage: {
      namespaces: {
        [SPACED_NAMESPACE]: {
          id: SPACED_NAMESPACE,
          entries: {
            table: {
              [SPACED_TABLE]: {
                columns: {
                  id: {
                    nativeType: 'int4',
                    codecId: 'pg/int4@1',
                    nullable: false,
                    many: false,
                  },
                  [SPACED_COLUMN]: {
                    nativeType: 'text',
                    codecId: 'pg/text@1',
                    nullable: true,
                    many: false,
                  },
                },
                uniques: [],
                indexes: [],
                foreignKeys: [],
              },
            },
          },
        },
      },
      types: {
        [SPACED_TYPE]: { kind: 'codec-instance', codecId: 'pg/text@1', nativeType: 'text' },
      },
    },
  });
}

function emitDts(): string {
  return generateContractDts(
    contractWithNonIdentifierNames(),
    sqlEmission,
    [],
    testHashes,
    undefined,
    identityCodecLookup,
  );
}

const DTS_FILE_NAME = 'contract.d.ts';

function syntaxErrorsOf(source: string): string[] {
  const sourceFile = ts.createSourceFile(
    DTS_FILE_NAME,
    source,
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.TS,
  );
  const host: ts.CompilerHost = {
    ...ts.createCompilerHost({}),
    getSourceFile: (name) => (name === DTS_FILE_NAME ? sourceFile : undefined),
  };
  // `noResolve`/`noLib` keep this a pure parse check — the emitted imports point
  // at workspace-internal specifiers that need not resolve to validate syntax.
  const program = ts.createProgram(
    [DTS_FILE_NAME],
    { noResolve: true, noLib: true, types: [] },
    host,
  );
  return program
    .getSyntacticDiagnostics(sourceFile)
    .map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' '));
}

describe('non-identifier physical names', () => {
  it('emits a syntactically valid contract.d.ts', () => {
    expect(syntaxErrorsOf(emitDts())).toEqual([]);
  });

  it('quotes a column name that is not a bare identifier', () => {
    expect(emitDts()).toContain(
      'readonly "has space": { readonly nativeType: "text"; readonly codecId: "pg/text@1"; readonly nullable: true; readonly many: false }',
    );
  });

  it('quotes a table name that is not a bare identifier', () => {
    expect(emitDts()).toContain('readonly "data rows": { columns: {');
  });

  it('quotes a document-scoped storage type name that is not a bare identifier', () => {
    expect(emitDts()).toContain('readonly "my type": { readonly kind: "codec-instance"');
  });
});
