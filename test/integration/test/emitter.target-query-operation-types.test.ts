import type { Contract } from '@internal/contract/types';
import { generateContractDts } from '@internal/emitter';
import { extractQueryOperationTypeImports } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import type { SqlStorage } from '@internal/sql-contract/types';
import { sqlEmission } from '@internal/sql-contract-emitter';
import postgresTarget from '@internal/target-postgres/control';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';

describe('emitter + postgres target descriptor', () => {
  it('surfaces target-declared queryOperationTypes.import in generated contract.d.ts', () => {
    const ir: Contract<SqlStorage> = {
      target: 'postgres',
      targetFamily: 'sql',
      roots: {},
      domain: applicationDomainOf({ models: {} }),
      storage: {
        storageHash: 'storage:test' as never,
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: postgresCreateNamespace({
            id: UNBOUND_NAMESPACE_ID,
            entries: { table: {} },
          }),
        },
      },
      capabilities: {},
      extensions: {},
      profileHash: 'profile:test' as never,
      meta: {},
    };
    const queryOperationTypeImports = extractQueryOperationTypeImports([postgresTarget]);

    const types = generateContractDts(
      ir,
      sqlEmission,
      [],
      { storageHash: 'h', profileHash: 'p' },
      { queryOperationTypeImports },
    );

    expect(types).toContain(
      "import type { QueryOperationTypes as PgTargetQueryOps } from '@internal/target-postgres/operation-types'",
    );
    expect(types).toContain('export type QueryOperationTypes = PgTargetQueryOps');
  });
});
