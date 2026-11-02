import { describe, expect, it } from 'vitest';
import { detectionPatterns } from '../guide-detections';

const APP_NOTE =
  'upgrade-instructions/pending/mongo-checks-required-extensions/app/instructions.md';
const EXTENSION_NOTE =
  'upgrade-instructions/pending/mongo-checks-required-extensions/extension/instructions.md';

const matcher = (path: string, id: string) => (content: string) =>
  detectionPatterns(path, id).some((pattern) => pattern.test(content));

describe('the app mongo-client-takes-extensions detection', () => {
  const matches = matcher(APP_NOTE, 'mongo-client-takes-extensions');

  it('matches a MongoDB config that composes extensions, and not other configs', () => {
    expect([
      matches(
        "import { defineConfig } from '@prisma/orm-mongo/config';\nimport myPack from 'my-pack/control';\n\nexport default defineConfig({\n  contract: './prisma/schema.prisma',\n  extensions: [myPack],\n});\n",
      ),
      matches(
        "import { defineConfig } from '@prisma/orm-mongo/config';\n\nexport default defineConfig({ contract: './prisma/schema.prisma' });\n",
      ),
      matches(
        "import { defineConfig } from '@prisma/orm-postgres/config';\nimport pgvector from '@prisma/orm-extension-pgvector/control';\n\nexport default defineConfig({ contract: './prisma/schema.prisma', extensions: [pgvector] });\n",
      ),
    ]).toEqual([true, false, false]);
  });
});

describe('the extension mongo-execution-context-checks-contract-requirements detection', () => {
  const matches = matcher(EXTENSION_NOTE, 'mongo-execution-context-checks-contract-requirements');

  it('matches code that builds a MongoDB context or extension descriptor, and not SQL code', () => {
    expect([
      matches('const context = createMongoExecutionContext({ contract, stack });'),
      matches('const pack: MongoRuntimeExtensionDescriptor<"mongo"> = { kind: "extension" };'),
      matches('const context = createExecutionContext({ contract, stack });'),
      matches('const pack: SqlRuntimeExtensionDescriptor<"postgres"> = { kind: "extension" };'),
    ]).toEqual([true, true, false, false]);
  });
});
