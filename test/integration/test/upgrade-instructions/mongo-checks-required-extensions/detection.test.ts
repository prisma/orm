import { describe, expect, it } from 'vitest';
import { detectionPatterns, guideChange, guideChanges, patternsOf } from '../guide-detections';

const APP_NOTE =
  'skills/prisma-8/upgrading/app/upgrades/8.0.0-rc.22-to-8.0.0-rc.23/instructions.md';
const EXTENSION_NOTE =
  'skills/prisma-8/upgrading/extension/upgrades/8.0.0-rc.22-to-8.0.0-rc.23/instructions.md';

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

describe('the extension mongo-codecs-declared-once detection, within one object', () => {
  const matches = matcher(EXTENSION_NOTE, 'mongo-codecs-declared-once');

  it('matches a codecs slot in the same object as the MongoDB marker, in either order', () => {
    expect([
      matches(
        "function target(): MongoRuntimeTargetDescriptor<'mongo'> {\n  return {\n    kind: 'target',\n    create: () => ({ familyId: 'mongo', targetId: 'mongo' }),\n    codecs: () => registry,\n  };\n}",
      ),
      matches(
        "export default {\n  kind: 'extension',\n  codecs: () => registry,\n  targetId: 'mongo',\n  familyId: 'mongo',\n};\n",
      ),
    ]).toEqual([true, true]);
  });

  it('does not match a codecs key in another object than the MongoDB marker', () => {
    expect([
      matches(
        "const pack: SqlRuntimeExtensionDescriptor<'postgres'> = {\n  familyId: 'sql',\n  codecs: () => [],\n};\nconst wrongFamily = {\n  name: 'mongo-only',\n  familyId: 'mongo',\n  intercept: async () => undefined,\n};\n",
      ),
      matches(
        "const wrongFamily = {\n  familyId: 'mongo',\n  name: 'mongo-only',\n};\nconst pack: SqlRuntimeExtensionDescriptor<'postgres'> = {\n  familyId: 'sql',\n  codecs: () => [],\n};\n",
      ),
      matches(
        "import type { MongoRuntimeAdapterDescriptor } from '@prisma/orm-mongo/family-runtime';\nconst adapter: MongoRuntimeAdapterDescriptor<'mongo'> = { kind: 'adapter', id: 'mongo', create };\nconst context: MongoExecutionContext<Contract> = Object.freeze({\n  contract,\n  codecs: registry,\n});\n",
      ),
    ]).toEqual([false, false, false]);
  });
});

describe('the app mongo-client-takes-extensions detection, for the shorthand property', () => {
  const matches = matcher(APP_NOTE, 'mongo-client-takes-extensions');

  it('matches extensions written as a shorthand property in a MongoDB config, and not a config without them', () => {
    expect([
      matches(
        "import { defineConfig } from '@prisma/orm-mongo/config';\nimport { extensions } from './extensions';\n\nexport default defineConfig({ contract: './prisma/schema.prisma', extensions });\n",
      ),
      matches(
        "import { defineConfig } from '@prisma/orm-mongo/config';\n\nconst contract = './prisma/schema.prisma';\nexport default defineConfig({\n  contract,\n  extensions,\n});\n",
      ),
      matches(
        "import { defineConfig } from '@prisma/orm-mongo/config';\n\n// Add extensions here later.\nexport default defineConfig({ contract: './prisma/schema.prisma' });\n",
      ),
    ]).toEqual([true, true, false]);
  });
});

describe('the extension mongo-codecs-declared-once detection, for spread metadata and nested values', () => {
  const matches = matcher(EXTENSION_NOTE, 'mongo-codecs-declared-once');

  it('matches a codecs slot in a file that uses the MongoDB codec registry, with the family in another module', () => {
    expect([
      matches(
        "import { newMongoCodecRegistry } from '@prisma/orm-family-mongo/codec';\nimport meta from './meta.js';\n\nconst registry = newMongoCodecRegistry();\nexport default { ...meta, create, codecs() { return registry; } };\n",
      ),
      matches(
        "import meta from './meta.js';\n\n/** @type {() => import('@prisma/orm-family-mongo/codec').MongoCodecRegistry} */\nconst build = () => registry;\nexport default { ...meta, create, codecs: () => build() };\n",
      ),
      matches(
        "import type { MongoCodecRegistry } from '@prisma/orm-family-mongo/codec';\n\nconst context = Object.freeze({ contract, codecs: registry as MongoCodecRegistry });\n",
      ),
    ]).toEqual([true, true, false]);
  });

  it('matches a codecs slot beside nested codec descriptors, in either order', () => {
    expect([
      matches(
        "export default {\n  kind: 'extension',\n  familyId: 'mongo',\n  types: { codecTypes: { codecDescriptors: [mongoCodecDescriptor(codec, { traits: ['equality'] })] } },\n  codecs() {\n    return registry;\n  },\n};\n",
      ),
      matches(
        "export default {\n  kind: 'extension',\n  codecs: () => registry,\n  types: { codecTypes: { codecDescriptors: [mongoCodecDescriptor(codec, { traits: ['equality'] })] } },\n  familyId: 'mongo',\n};\n",
      ),
      matches(
        "const pack: MongoRuntimeExtensionDescriptor<'mongo'> = {\n  kind: 'extension',\n  types: { codecTypes: { codecDescriptors: [mongoCodecDescriptor(codec, { traits: ['equality'] })] } },\n  codecs: () => registry,\n};\n",
      ),
    ]).toEqual([true, true, true]);
  });
});

describe('the detections, on files that only look like the old code', () => {
  const codecsSlot = matcher(EXTENSION_NOTE, 'mongo-codecs-declared-once');
  const configExtensions = matcher(APP_NOTE, 'mongo-client-takes-extensions');

  it('match a spread descriptor whose codecs method has a return type, and a config whose shorthand extensions come first', () => {
    expect([
      codecsSlot(
        "import { newMongoCodecRegistry } from 'x';\nexport const rt = {\n  ...meta,\n  codecs(): MongoCodecRegistry {\n    return newMongoCodecRegistry();\n  },\n};",
      ),
      configExtensions(
        "import { defineConfig } from '@prisma/orm-mongo/config';\nexport default defineConfig({ extensions, contract: 'x' });",
      ),
    ]).toEqual([true, true]);
  });

  it('do not match a SQL codecs slot in a file that names the MongoDB registry, or extensions in a comment', () => {
    expect([
      codecsSlot(
        "import { MongoCodecRegistry } from 'x';\nconst sqlPack = { familyId: 'sql', codecs: () => [] };",
      ),
      codecsSlot(
        "import { MongoCodecRegistry } from 'x';\nconst sqlPack = { ...sqlMeta, familyId: 'sql', codecs: () => [] };",
      ),
      configExtensions(
        "import { defineConfig } from '@prisma/orm-mongo/config';\nexport default defineConfig({ contract: './prisma/schema.prisma' });\n// extensions, later",
      ),
    ]).toEqual([false, false, false]);
  });
});

describe('every detection in the MongoDB required-extensions notes', () => {
  const adversarial = [
    `familyId: "mongo"${' {'.repeat(500_000)}`,
    `familyId: "mongo"${'{ { { '.repeat(100_000)}${'x'.repeat(400_000)}`,
    `MongoCodecRegistry\n${'codecs: ('.repeat(110_000)}`,
    `MongoCodecRegistry\n${'codecs ( '.repeat(110_000)}`,
    `MongoCodecRegistry\n{ ...meta, ${'codecs: () => x, '.repeat(60_000)}`,
    `MongoRuntimeExtensionDescriptor<'mongo'> = {${'{a:{b:{c:1}}}, '.repeat(70_000)}`,
    `codecs: ${'{ '.repeat(3)}${'a'.repeat(1_000_000)}`,
    `${'codecs: () => x, '.repeat(60_000)}familyId: 'mongo'`,
    `import '@prisma/orm-mongo/config';\n${'extensions '.repeat(90_000)}`,
    `{"targetFamily": "mongo", ${'"x": 1, '.repeat(120_000)}}`,
  ];
  const patterns = [APP_NOTE, EXTENSION_NOTE].flatMap((note) =>
    guideChanges(note).flatMap((change) =>
      patternsOf(change).map((pattern) => ({ id: change.id, pattern })),
    ),
  );

  it.each(adversarial.map((input, index) => ({ index, input })))(
    'finishes within a second on adversarial input $index',
    ({ input }) => {
      for (const { pattern } of patterns) {
        const started = performance.now();
        pattern.test(input);
        expect(performance.now() - started).toBeLessThan(1000);
      }
    },
  );
});
