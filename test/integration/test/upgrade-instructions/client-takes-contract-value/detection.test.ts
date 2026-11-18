import { describe, expect, it } from 'vitest';
import { detectionPatterns } from '../guide-detections';

const GUIDE_PATHS = {
  app: 'skills/prisma-8/upgrading/app/upgrades/8.0.0-rc.18-to-8.0.0-rc.19/instructions.md',
  extension:
    'skills/prisma-8/upgrading/extension/upgrades/8.0.0-rc.18-to-8.0.0-rc.19/instructions.md',
} as const;

function detects(audience: keyof typeof GUIDE_PATHS, content: string): boolean {
  return detectionPatterns(GUIDE_PATHS[audience], 'client-takes-contract-value').some((pattern) =>
    pattern.test(content),
  );
}

describe.each(['app', 'extension'] as const)(
  '%s client-takes-contract-value detection of a client imported under another name',
  (audience) => {
    it.each([
      [
        'a default import beside named imports',
        "import ormPostgresRuntime, {\n  type PostgresClient,\n} from '@prisma/orm-postgres/runtime';\n\nfunction build() {\n  return ormPostgresRuntime<OrmContractOf<C>>({\n    ...options,\n    contractJson: contract.__cmp.contractJson,\n  });\n}",
      ],
      [
        'a renamed named import',
        "import { mongoQuery as query } from '@prisma/orm-mongo/query-builder';\nconst q = query<Contract>({ contractJson });",
      ],
      [
        'a default import after other imports from the same module',
        "import { a } from './a';\nimport type { PostgresClient } from '@prisma/orm-postgres/runtime';\nimport pg from '@prisma/orm-postgres/runtime';\nconst db = pg<Contract<Db>>({ contractJson });",
      ],
    ])('finds %s', (_name, content) => {
      expect(detects(audience, content)).toBe(true);
    });

    it.each([
      [
        'the renamed client given a contract value',
        "import ormPostgresRuntime from '@prisma/orm-postgres/runtime';\nconst db = ormPostgresRuntime({ contract, url });",
      ],
      [
        'a function from another module',
        "import build from './build';\nconst db = build({ contractJson });",
      ],
    ])('skips %s', (_name, content) => {
      expect(detects(audience, content)).toBe(false);
    });

    it.each([
      ['default imports', "import pg from '@prisma/orm-postgres/runtime';\n"],
      ['renamed imports', "import { default as pg } from '@prisma/orm-postgres/runtime';\n"],
      ['unclosed import lists', "import pg, { a from '@prisma/orm-postgres/runtime';\n"],
    ])('reads 400 KB of repeated %s in linear time', (_name, line) => {
      const content = line.repeat(Math.ceil(400_000 / line.length));
      const start = performance.now();
      const found = detects(audience, content);
      expect({ found, fast: performance.now() - start < 1000 }).toEqual({
        found: false,
        fast: true,
      });
    });
  },
);
