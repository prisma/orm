import type { ControlPolicy } from '@internal/contract/types';
import type { TargetPackRef } from '@internal/framework-components/components';
import { test } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { typescriptContractFromPath } from '../src/config-types';

declare const target: TargetPackRef<'sql', 'postgres'>;
declare const defaultControlPolicy: ControlPolicy;

test('typescriptContractFromPath takes defaultControlPolicy and createNamespace together or not at all', () => {
  const contractBuilderModule = '@prisma/orm-postgres/contract-builder';
  const targetOnly = { target, contractBuilderModule };
  const both = {
    target,
    contractBuilderModule,
    defaultControlPolicy,
    createNamespace: createTestSqlNamespace,
  };
  const policyOnly = { target, contractBuilderModule, defaultControlPolicy };
  const namespaceOnly = { target, contractBuilderModule, createNamespace: createTestSqlNamespace };

  typescriptContractFromPath('./contract.ts', undefined, targetOnly);
  typescriptContractFromPath('./contract.ts', undefined, both);
  // @ts-expect-error a policy without the namespace factory its strip needs
  typescriptContractFromPath('./contract.ts', undefined, policyOnly);
  // @ts-expect-error a namespace factory without a policy
  typescriptContractFromPath('./contract.ts', undefined, namespaceOnly);
});
