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

  it('reports the attribute on the enum member and produces no contract', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'psl-provider-enum-'));
    tempDirs.push(tempDir);
    const schemaPath = join(tempDir, 'schema.prisma');
    await writeFile(
      schemaPath,
      `// use prisma-8
enum Role {
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
      summary: 'PSL to SQL contract interpretation failed',
      diagnostics: [
        {
          code: 'PSL_UNSUPPORTED_ENUM_MEMBER_ATTRIBUTE',
          message:
            'enum "Role": member "USER" carries @map, but an enum member takes no attributes',
          sourceId: schemaPath,
          span: {
            start: { offset: 58, line: 4, column: 9 },
            end: { offset: 70, line: 4, column: 21 },
          },
        },
      ],
    });
  });
});
