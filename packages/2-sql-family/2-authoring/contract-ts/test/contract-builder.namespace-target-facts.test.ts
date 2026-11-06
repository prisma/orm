import type { FamilyPackRef, TargetPackRef } from '@internal/framework-components/components';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { testTypeLookups } from '../../../1-core/contract/test/test-type-lookups';
import { defineContract, field, model } from '../src/contract-builder';
import { columnDescriptor } from './helpers/column-descriptor';

const sqlFamilyPack: FamilyPackRef<'sql'> = {
  kind: 'family',
  id: 'sql',
  familyId: 'sql',
  version: '0.0.1',
};

const targetWithoutNamespaces: TargetPackRef<'sql', 'mysql'> = {
  kind: 'target',
  id: 'mysql',
  familyId: 'sql',
  targetId: 'mysql',
  version: '0.0.1',
  defaultNamespaceId: '__unbound__',
  supportsNamespaces: false,
  displayName: 'MySQL',
};

const targetWithNamespaces: TargetPackRef<'sql', 'cockroach'> = {
  kind: 'target',
  id: 'cockroach',
  familyId: 'sql',
  targetId: 'cockroach',
  version: '0.0.1',
  defaultNamespaceId: 'public',
  supportsNamespaces: true,
  displayName: 'CockroachDB',
};

const userModelArgs = {
  fields: {
    id: field.column(columnDescriptor('pg/int4@1')).id(),
  },
} as const;

function build(target: TargetPackRef<'sql', string>, input: object) {
  return () =>
    defineContract({
      ...testTypeLookups,
      family: sqlFamilyPack,
      target,
      createNamespace: createTestSqlNamespace,
      ...input,
    });
}

describe('defineContract namespace rules read from the target descriptor', () => {
  it('refuses a namespaces list on a target that reports no namespaces', () => {
    expect(build(targetWithoutNamespaces, { namespaces: ['auth'] })).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.NAMESPACE_UNSUPPORTED',
        message:
          'defineContract: MySQL contracts cannot declare namespaces. Received namespaces: ["auth"].',
      }),
    );
  });

  it('refuses a per-model namespace on a target that reports no namespaces', () => {
    expect(
      build(targetWithoutNamespaces, {
        models: { User: model('User', { namespace: 'auth', ...userModelArgs }) },
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.NAMESPACE_UNSUPPORTED',
        message:
          'defineContract: model "User" sets `namespace: "auth"` but the target is MySQL, which does not support namespaces (remove the per-model `namespace` field).',
      }),
    );
  });

  it('reserves the PSL keyword `unbound` on every target that reports namespaces', () => {
    expect(build(targetWithNamespaces, { namespaces: ['unbound'] })).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.NAMESPACE_INVALID',
        meta: { namespace: 'unbound', reason: 'reserved-psl-keyword', targetId: 'cockroach' },
      }),
    );
    expect(
      build(targetWithNamespaces, {
        namespaces: ['public'],
        models: { User: model('User', { namespace: 'unbound', ...userModelArgs }) },
      }),
    ).toThrow(
      expect.objectContaining({
        message: expect.stringMatching(
          /namespace: "unbound"` but that name is reserved by CockroachDB.*namespace unbound \{ … \}/,
        ),
        meta: {
          modelKey: 'User',
          namespace: 'unbound',
          reason: 'reserved-psl-keyword',
          targetId: 'cockroach',
        },
      }),
    );
  });
});
