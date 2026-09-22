import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { timeouts } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { format } from '../utils/cli-commands';
import { withTempDir } from '../utils/cli-test-helpers';
import { runFormat, setupJourney } from '../utils/journey-test-helpers';

const MESSY_PSL = `model    User    {
id     Int      @id @default(autoincrement())
email String @unique
   name String
}

enum Role {
@@type("pg/text@1")
USER
ADMIN
}`;

function pslConfig(): string {
  return `import postgresAdapter from '@prisma/orm-postgres/adapter/control';
import { definePrismaConfig } from '@prisma/cli-engine';
import sql from '@prisma/orm-postgres/family/control';
import { prismaContract } from '@prisma/orm-family-sql/contract-psl/provider';
import postgres from '@prisma/orm-postgres/target/control';
import { postgresCreateNamespace } from '@prisma/orm-postgres/target/types';

export default definePrismaConfig({
  orm: {
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  extensions: [],
  formatter: { newline: 'LF' },
  contract: prismaContract('./contract.prisma', {
    output: 'output/contract.json',
    target: postgres,
    createNamespace: postgresCreateNamespace,
  }),
},
});
`;
}

withTempDir(({ createTempDir }) => {
  describe('Journey F: Format command', () => {
    it(
      'F.01: formats a PSL contract source in place',
      async () => {
        const ctx = setupJourney({ createTempDir });
        const sourcePath = join(ctx.testDir, 'contract.prisma');
        writeFileSync(sourcePath, MESSY_PSL, 'utf-8');
        writeFileSync(ctx.configPath, pslConfig(), 'utf-8');

        const result = await runFormat(ctx);

        expect(result.exitCode, 'F.01: format PSL in place').toBe(0);
        expect(result.presented?.data, 'F.01: reports the file it rewrote').toEqual({
          formatted: true,
          path: sourcePath,
        });

        const onDisk = readFileSync(sourcePath, 'utf-8');
        const expected = format(MESSY_PSL, { indent: 2, newline: 'LF' });
        expect(onDisk, 'F.01: file rewritten to canonical form').toBe(expected);
        expect(onDisk, 'F.01: file actually changed').not.toBe(MESSY_PSL);
      },
      timeouts.coldTransformImport,
    );

    it(
      'F.02: leaves a non-PSL contract source untouched',
      async () => {
        const ctx = setupJourney({ createTempDir });
        const sourcePath = join(ctx.testDir, 'contract.prisma');
        writeFileSync(sourcePath, MESSY_PSL, 'utf-8');
        writeFileSync(
          ctx.configPath,
          `import postgresAdapter from '@prisma/orm-postgres/adapter/control';
import { definePrismaConfig } from '@prisma/cli-engine';
import sql from '@prisma/orm-postgres/family/control';
import postgres from '@prisma/orm-postgres/target/control';

export default definePrismaConfig({
  orm: {
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  extensions: [],
  contract: {
    source: {
      format: 'typescript',
      inputs: ['./contract.prisma'],
      load: async () => ({ ok: false as const, error: { summary: 'not loaded', diagnostics: [] } }),
    },
    output: 'output/contract.json',
    types: 'output/contract.d.ts',
  },
},
});
`,
          'utf-8',
        );

        const before = readFileSync(sourcePath, 'utf-8');
        const result = await runFormat(ctx);

        expect(result.exitCode, 'F.02: non-PSL source exits 0').toBe(0);
        expect(result.stderr, 'F.02: reports nothing to format').toContain('Nothing to format');
        expect(result.stdout, 'F.02: human mode writes nothing to stdout').toBe('');

        const after = readFileSync(sourcePath, 'utf-8');
        expect(after, 'F.02: source byte-identical').toBe(before);
      },
      timeouts.coldTransformImport,
    );

    it(
      'F.03: refuses unparseable PSL with a non-zero exit and no partial write',
      async () => {
        const ctx = setupJourney({ createTempDir });
        const sourcePath = join(ctx.testDir, 'contract.prisma');
        const unparseable = 'model User { this is not valid PSL @@@ ';
        writeFileSync(sourcePath, unparseable, 'utf-8');
        writeFileSync(ctx.configPath, pslConfig(), 'utf-8');

        const before = readFileSync(sourcePath, 'utf-8');
        const result = await runFormat(ctx, ['--json']);

        expect(result.exitCode, 'F.03: unparseable PSL non-zero exit').toBe(2);
        expect(result.json.at(-1), 'F.03: settles as an errored envelope').toMatchObject({
          kind: 'result',
          envelope: { ok: false, error: { code: 'PSL.PARSE_FAILED' } },
        });

        const after = readFileSync(sourcePath, 'utf-8');
        expect(after, 'F.03: source untouched on refusal').toBe(before);
      },
      timeouts.coldTransformImport,
    );
  });
});
