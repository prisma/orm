import type { TargetPackRef } from '@internal/framework-components/components';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { fixtureInterpreterTypes } from './fixture-codec-descriptors';
import {
  createBuiltinLikeControlMutationDefaults,
  interpretSqlContract,
  postgresTarget,
  sqliteScalarColumnDescriptors,
} from './fixtures';

const targetWithoutNamespaces: TargetPackRef<'sql', 'mysql'> = {
  kind: 'target',
  familyId: 'sql',
  targetId: 'mysql',
  id: 'mysql',
  version: '0.0.1',
  capabilities: {},
  defaultNamespaceId: '__unbound__',
  supportsNamespaces: false,
  displayName: 'MySQL',
};

function diagnosticsFor(schema: string, target: TargetPackRef<'sql', string>) {
  const result = interpretSqlContract(schema, {
    target,
    scalarColumnDescriptors: sqliteScalarColumnDescriptors,
    composedExtensionContracts: new Map(),
    controlMutationDefaults: createBuiltinLikeControlMutationDefaults(),
    createNamespace: createTestSqlNamespace,
    ...fixtureInterpreterTypes,
    capabilities: { sql: { scalarList: true } },
  });
  return result.ok ? [] : result.failure.diagnostics.map(({ code, message }) => [code, message]);
}

describe('namespace blocks on a target whose descriptor reports no namespaces', () => {
  it('refuses each block with the name the target supplies', () => {
    expect(
      diagnosticsFor(
        'namespace auth {\n  model User {\n    id Int @id\n  }\n}\n',
        targetWithoutNamespaces,
      ),
    ).toEqual([
      [
        'PSL_UNSUPPORTED_NAMESPACE_BLOCK',
        'MySQL does not support `namespace auth { … }` blocks (declare models at the document top level instead).',
      ],
    ]);
  });

  it('refuses `namespace unbound { … }` too', () => {
    expect(
      diagnosticsFor(
        'namespace unbound {\n  model User {\n    id Int @id\n  }\n}\n',
        targetWithoutNamespaces,
      ),
    ).toEqual([
      [
        'PSL_UNSUPPORTED_NAMESPACE_BLOCK',
        'MySQL does not support `namespace unbound { … }` blocks (declare models at the document top level instead).',
      ],
    ]);
  });

  it('names the target by its id when the descriptor gives no display name', () => {
    const { displayName: _displayName, ...bare } = targetWithoutNamespaces;
    expect(diagnosticsFor('namespace auth {}\n', bare)).toEqual([
      [
        'PSL_UNSUPPORTED_NAMESPACE_BLOCK',
        'mysql does not support `namespace auth { … }` blocks (declare models at the document top level instead).',
      ],
    ]);
  });

  it('accepts namespace blocks on a target that reports namespaces', () => {
    expect(diagnosticsFor('namespace auth {}\n', postgresTarget)).toEqual([]);
  });
});
