import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { JsonValue } from '@internal/contract/types';
import type { Codec, CodecLookup } from '@internal/framework-components/codec';
import { join } from 'pathe';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { prismaContract } from '../src/exports/provider';
import {
  createPostgresTestContext,
  postgresCodecLookup,
  postgresTarget,
  testEnumEntityContributions,
  testEnumPslBlockDescriptor,
} from './fixtures';

const textCodec: Codec = {
  id: 'pg/text@1',
  encode: async (value: unknown) => value,
  decode: async (wire: unknown) => wire,
  encodeJson: (value) => value as JsonValue,
  decodeJson: (json) => json,
};

async function loadWithEnumSupport(schemaPath: string) {
  const contract = prismaContract('./schema.prisma', {
    target: postgresTarget,
    createNamespace: createTestSqlNamespace,
  });
  const baseContext = createPostgresTestContext();
  const codecLookup: CodecLookup = {
    ...postgresCodecLookup,
    get: (id) => (id === textCodec.id ? textCodec : postgresCodecLookup.get(id)),
  };
  return contract.source.load({
    ...baseContext,
    resolvedInputs: [schemaPath],
    codecLookup,
    authoringContributions: {
      ...baseContext.authoringContributions,
      entityTypes: testEnumEntityContributions,
      pslBlockDescriptors: { enum: testEnumPslBlockDescriptor },
    },
  });
}

describe('prismaContract given an attribute on an enum member', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tempDirs) {
      await rm(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it('fails with an invalid block entry diagnostic at the attribute and produces no contract', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'psl-provider-enum-'));
    tempDirs.push(tempDir);
    const schemaPath = join(tempDir, 'schema.prisma');
    await writeFile(
      schemaPath,
      `enum Role {
  @@type("pg/text@1")
  USER  @map("user")
  ADMIN
}

model User {
  id   Int  @id
  role Role
}
`,
      'utf-8',
    );

    const result = await loadWithEnumSupport(schemaPath);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toEqual({
      summary: 'Schema has 1 error',
      diagnostics: [
        {
          code: 'PSL_INVALID_EXTENSION_BLOCK_MEMBER',
          message: 'Invalid block entry',
          sourceId: './schema.prisma',
          span: {
            start: { offset: 42, line: 3, column: 9 },
            end: { offset: 43, line: 3, column: 10 },
          },
        },
      ],
    });
  });
});
