import type { PrismaNextConfig } from '@internal/config/config-types';
import { blindCast } from '@internal/utils/casts';
import type { ConfigSection as EngineConfigSection, SectionProvenance } from '@prisma/cli-engine';
import { configSchema, defineConfigSection, validateSectionWithSchema } from '@prisma/cli-engine';

/** The single config section the `orm` command family owns. */
export const ORM_CONFIG_SECTION_NAME = 'orm';

/**
 * Top-level subsections of the `orm` section. Diagnostics carry the
 * subsection they concern so commands can fail on the ones they read and
 * ignore the rest.
 */
export type ConfigSection =
  | 'family'
  | 'target'
  | 'adapter'
  | 'driver'
  | 'extensions'
  | 'db'
  | 'contract'
  | 'migrations'
  | 'formatter';

const CONFIG_SECTIONS: readonly ConfigSection[] = [
  'family',
  'target',
  'adapter',
  'driver',
  'extensions',
  'db',
  'contract',
  'migrations',
  'formatter',
];

export function isConfigSection(value: string): value is ConfigSection {
  return CONFIG_SECTIONS.some((section) => section === value);
}

const targetDescriptor = {
  kind: "'target'",
  id: 'string',
  familyId: 'string',
  targetId: 'string',
  version: 'string',
  create: 'Function',
} as const;

const adapterDescriptor = { ...targetDescriptor, kind: "'adapter'" } as const;
const driverDescriptor = { ...targetDescriptor, kind: "'driver'" } as const;
const extensionDescriptor = { ...targetDescriptor, kind: "'extension'" } as const;

/**
 * The shape of the `orm` section of `prisma.config.ts`, declared once. The
 * CLI engine derives validation, the diagnostics naming a bad field and the
 * file to fix, and the resolution of every `path` field against the config
 * file that wrote it (prisma-cli ADR 0005). Relative paths are resolved
 * before any command sees the value, and the value carries `baseDir`.
 */
export const ormConfigSchema = configSchema({
  family: {
    kind: "'family'",
    id: 'string',
    familyId: 'string',
    version: 'string',
    emission: 'object',
    create: 'Function',
  },
  target: targetDescriptor,
  adapter: adapterDescriptor,
  'driver?': driverDescriptor,
  'extensions?': [extensionDescriptor, '[]'],
  'db?': { 'connection?': 'unknown' },
  'contract?': {
    source: { 'format?': 'string', 'inputs?': 'path[]', load: 'Function' },
    output: ['path', '=', () => 'src/prisma/contract.json'],
  },
  migrations: [{ dir: ['path', '=', () => './migrations'] }, '=', () => ({})],
  'formatter?': { 'indent?': "number.integer >= 1 | 'tab'", 'newline?': "'LF' | 'CRLF'" },
}).narrow((config, ctx) => {
  if ('extensionPacks' in config) {
    return ctx.reject({
      path: ['extensionPacks'],
      message: 'Config.extensionPacks is no longer supported; rename it to Config.extensions',
    });
  }
  const { familyId } = config.family;
  const { targetId } = config.target;
  if (config.target.familyId !== familyId) {
    return ctx.reject({
      path: ['target', 'familyId'],
      expected: `Config.family.familyId (${familyId})`,
      actual: config.target.familyId,
    });
  }
  const targetLike: ReadonlyArray<
    readonly [readonly PropertyKey[], { readonly familyId: string; readonly targetId: string }]
  > = [
    [['adapter'], config.adapter],
    ...(config.driver === undefined ? [] : [[['driver'], config.driver] as const]),
    ...(config.extensions ?? []).map(
      (extension, index) => [['extensions', index], extension] as const,
    ),
  ];
  for (const [path, descriptor] of targetLike) {
    if (descriptor.familyId !== familyId) {
      return ctx.reject({
        path: [...path, 'familyId'],
        expected: `Config.family.familyId (${familyId})`,
        actual: descriptor.familyId,
      });
    }
    if (descriptor.targetId !== targetId) {
      return ctx.reject({
        path: [...path, 'targetId'],
        expected: `Config.target.targetId (${targetId})`,
        actual: descriptor.targetId,
      });
    }
  }
  return true;
});

/**
 * The section token the ORM's commands declare in `needs.config`. The
 * engine validates the merged section with its provenance and hands the
 * handler the value: absolute paths, `migrations.dir` defaulted, `baseDir`
 * recorded.
 */
export const ormConfigSection: EngineConfigSection<PrismaNextConfig> = blindCast<
  EngineConfigSection<PrismaNextConfig>,
  'the schema declares the shape PrismaNextConfig describes; descriptor generics are erased by validation'
>(defineConfigSection({ name: ORM_CONFIG_SECTION_NAME, schema: ormConfigSchema }));

/**
 * Validates a raw `orm` section the way the engine does for a command,
 * for the loaders and tools that read the config outside a command run.
 */
export function validateOrmSection(
  raw: unknown,
  provenance: SectionProvenance,
): ReturnType<typeof ormConfigSection.validate> {
  return blindCast<
    ReturnType<typeof ormConfigSection.validate>,
    'the schema declares the shape PrismaNextConfig describes; descriptor generics are erased by validation'
  >(validateSectionWithSchema(ORM_CONFIG_SECTION_NAME, ormConfigSchema, raw, provenance));
}
