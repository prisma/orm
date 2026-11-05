import { describe, expect, it } from 'vitest';
import { detectionPatterns, guideChange } from '../guide-detections';

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

describe('the app mongo-contract-requires-target detection', () => {
  const matches = matcher(APP_NOTE, 'mongo-contract-requires-target');

  it('matches a MongoDB contract without a target, and not one with it or a SQL contract', () => {
    expect([
      matches('{\n  "targetFamily": "mongo",\n  "roots": {}\n}\n'),
      matches('{\n  "target": "mongo",\n  "targetFamily": "mongo",\n  "roots": {}\n}\n'),
      matches('{\n  "targetFamily": "mongo",\n  "target": "mongo"\n}\n'),
      matches('{\n  "targetFamily": "sql",\n  "roots": {}\n}\n'),
    ]).toEqual([true, false, false, false]);
  });
});

describe('the extension mongo-codecs-declared-once detection', () => {
  const matches = matcher(EXTENSION_NOTE, 'mongo-codecs-declared-once');

  it('matches a MongoDB descriptor with a codecs slot, and not one without it or a SQL one', () => {
    expect([
      matches(
        "const pack: MongoRuntimeExtensionDescriptor<'mongo'> = {\n  kind: 'extension',\n  codecs: () => registry,\n};",
      ),
      matches(
        "const pack: MongoRuntimeExtensionDescriptor<'mongo'> = {\n  kind: 'extension',\n  types: { codecTypes: { codecDescriptors } },\n};",
      ),
      matches(
        "const pack: SqlRuntimeExtensionDescriptor<'postgres'> = {\n  codecs: () => descriptors,\n};",
      ),
    ]).toEqual([true, false, false]);
  });
});

describe('the extension mongo-standard-codecs-removed detection', () => {
  const matches = matcher(EXTENSION_NOTE, 'mongo-standard-codecs-removed');

  it('matches the removed exports, and not the descriptors that replace them', () => {
    expect([
      matches('const registry = buildStandardCodecRegistry();'),
      matches("import { mongoStandardCodecs } from '@prisma/orm-mongo/target/codecs';"),
      matches("import { mongoCodecDescriptors } from '@prisma/orm-mongo/target/codecs';"),
    ]).toEqual([true, true, false]);
  });
});

describe('the detections that read source code', () => {
  it('are written for JavaScript files as well as TypeScript files', () => {
    const globs = [
      guideChange(APP_NOTE, 'mongo-client-takes-extensions'),
      guideChange(EXTENSION_NOTE, 'mongo-execution-context-checks-contract-requirements'),
      guideChange(EXTENSION_NOTE, 'mongo-codecs-declared-once'),
      guideChange(EXTENSION_NOTE, 'mongo-standard-codecs-removed'),
    ].map((change) => change.detection?.glob);
    expect(globs).toEqual(Array(4).fill('**/*.{ts,mts,cts,tsx,js,mjs,cjs,jsx}'));
  });
});

describe('the extension mongo-codecs-declared-once detection, for other ways of writing the slot', () => {
  const matches = matcher(EXTENSION_NOTE, 'mongo-codecs-declared-once');

  it('matches the method form on a typed descriptor and an untyped MongoDB descriptor in a .js file, and not a SQL one', () => {
    expect([
      matches(
        "const pack: MongoRuntimeExtensionDescriptor<'mongo'> = {\n  kind: 'extension',\n  codecs() {\n    return registry;\n  },\n};",
      ),
      matches(
        "export default {\n  kind: 'extension',\n  familyId: 'mongo',\n  targetId: 'mongo',\n  codecs: () => registry,\n};\n",
      ),
      matches(
        "export default {\n  kind: 'extension',\n  familyId: 'mongo',\n  codecs() {\n    return registry;\n  },\n};\n",
      ),
      matches(
        "export default {\n  kind: 'extension',\n  familyId: 'sql',\n  targetId: 'postgres',\n  codecs: () => descriptors,\n};\n",
      ),
      matches(
        "export default {\n  kind: 'extension',\n  familyId: 'mongo',\n  types: { codecTypes: { codecDescriptors } },\n};\n",
      ),
    ]).toEqual([true, true, true, false, false]);
  });
});
