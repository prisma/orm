import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import postgresAdapter from '@internal/adapter-postgres/control';
import { enrichContract } from '@internal/cli/control-api';
import sql from '@internal/family-sql/control';
import { createControlStack } from '@internal/framework-components/control';
import { sqlContractCanonicalizationHooks } from '@internal/sql-contract/canonicalization-hooks';
import { sqlEmission } from '@internal/sql-contract-emitter';
import { prismaContract } from '@internal/sql-contract-psl/provider';
import postgres from '@internal/target-postgres/control';
import postgresPackRef from '@internal/target-postgres/pack';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { emit } from '../../utils/emit';

const stack = createControlStack({ family: sql, target: postgres, adapter: postgresAdapter });

async function load(schema: string) {
  const schemaPath = join(mkdtempSync(join(tmpdir(), 'psl-types-blocks-')), 'schema.prisma');
  writeFileSync(schemaPath, schema, 'utf-8');
  const result = await prismaContract(schemaPath, {
    target: postgresPackRef,
    createNamespace: postgresCreateNamespace,
  }).source.load({
    composedExtensions: [],
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
  return { schemaPath, result };
}

describe('PSL types blocks', () => {
  it('emits a schema with several types blocks', async () => {
    const { result } = await load(`// use prisma-8
types {
  Email = String
}

model User {
  id Int @id
  email Email
  slug Slug
}

types {
  Slug = Varchar(191)
}
`);
    if (!result.ok) throw new Error(JSON.stringify(result.failure.diagnostics));

    await expect(
      emit(
        enrichContract(result.value, [postgres, postgresAdapter]),
        stack,
        sqlEmission,
        sqlContractCanonicalizationHooks,
      ),
    ).resolves.not.toThrow();
  });

  it('reports a named type repeated in another types block', async () => {
    const { schemaPath, result } = await load(`// use prisma-8
types {
  Slug = Varchar(191)
}

types {
  Slug = Varchar(10)
}

model User {
  id Int @id
  slug Slug
}
`);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toMatchObject({
      summary: 'Schema has 1 error',
      diagnostics: [
        {
          code: 'PSL_DUPLICATE_DECLARATION',
          message: 'Duplicate declaration of "Slug"',
          sourceId: schemaPath,
          span: { start: { line: 7, column: 3 } },
        },
      ],
    });
  });
});
