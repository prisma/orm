import type { PrismaNextConfig } from '@internal/config/config-types';
import { blindCast } from '@internal/utils/casts';
import type { ConfigSection as EngineConfigSection, SectionProvenance } from '@prisma/cli-engine';
import { configSchema, defineConfigSection, validateSectionWithSchema } from '@prisma/cli-engine';
import { type } from 'arktype';

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

type DescriptorKind = 'family' | 'target' | 'adapter' | 'driver' | 'extension';

const DESCRIPTOR_STRING_FIELDS = ['id', 'familyId', 'version'] as const;

type Problem = { readonly field: string; readonly expected: string; readonly actual: string };

function descriptorProblems(
  kind: DescriptorKind,
  targetLike: boolean,
  value: Record<string, unknown>,
): readonly Problem[] {
  const problems: Problem[] = [];
  if (value['kind'] !== kind) {
    problems.push({ field: 'kind', expected: `'${kind}'`, actual: JSON.stringify(value['kind']) });
  }
  for (const field of DESCRIPTOR_STRING_FIELDS) {
    if (typeof value[field] !== 'string') {
      problems.push({ field, expected: 'a string', actual: typeof value[field] });
    }
  }
  if (targetLike && typeof value['targetId'] !== 'string') {
    problems.push({ field: 'targetId', expected: 'a string', actual: typeof value['targetId'] });
  }
  if (kind === 'family' && (typeof value['emission'] !== 'object' || value['emission'] === null)) {
    problems.push({
      field: 'emission',
      expected: 'an EmissionSpi object',
      actual: typeof value['emission'],
    });
  }
  if (typeof value['create'] !== 'function') {
    problems.push({ field: 'create', expected: 'a function', actual: typeof value['create'] });
  }
  return problems;
}

/**
 * A control descriptor is a runtime object the config file constructs: its
 * `create` closes over module state, and its nested tables (codecs, the
 * contract serializer, migration hooks) rely on their prototypes and on
 * `this`. arktype rebuilds every object it validates structurally, which would
 * strip all of that. So a descriptor is validated by predicate, which keeps
 * the reference the file built, and only its identifying fields are checked.
 * Every problem is reported, at its full path: a predicate's own `path` is
 * relative to the value, so the traversal path is prepended by hand.
 */
function descriptor(kind: DescriptorKind, targetLike: boolean) {
  return type('object').narrow((value, ctx) => {
    const problems = descriptorProblems(kind, targetLike, value as Record<string, unknown>);
    for (const problem of problems) {
      ctx.error({
        path: [...ctx.path, problem.field],
        expected: problem.expected,
        actual: problem.actual,
      });
    }
    return problems.length === 0;
  });
}

/**
 * The contract source provider: its `load` closes over the authored contract
 * and is kept by reference (arktype never clones functions), while `inputs`
 * are paths the schema resolves against the config file. Other keys a
 * provider carries (`format`, provider-specific fields) pass through.
 */
const contractSource = {
  load: 'Function',
  'inputs?': 'path[]',
  'format?': 'string',
  '+': 'ignore',
} as const;

/**
 * The shape of the `orm` section of `prisma.config.ts`, declared once. The
 * CLI engine derives validation, the diagnostics naming a bad field and the
 * file to fix, and the resolution of every `path` field against the config
 * file that wrote it (prisma-cli ADR 0005). Relative paths are resolved
 * before any command sees the value, and the value carries `baseDir`.
 */
export const ormConfigSchema = configSchema({
  family: descriptor('family', false),
  target: descriptor('target', true),
  adapter: descriptor('adapter', true),
  'driver?': descriptor('driver', true),
  'extensions?': [descriptor('extension', true), '[]'],
  'db?': { 'connection?': 'unknown' },
  'contract?': {
    source: contractSource,
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
  const family = config.family as { readonly familyId: string };
  const target = config.target as { readonly familyId: string; readonly targetId: string };
  if (target.familyId !== family.familyId) {
    return ctx.reject({
      path: ['target', 'familyId'],
      expected: `Config.family.familyId (${family.familyId})`,
      actual: target.familyId,
    });
  }
  const targetLike: ReadonlyArray<
    readonly [readonly PropertyKey[], { readonly familyId: string; readonly targetId: string }]
  > = [
    [['adapter'], config.adapter as { familyId: string; targetId: string }],
    ...(config.driver === undefined
      ? []
      : [[['driver'], config.driver as { familyId: string; targetId: string }] as const]),
    ...(config.extensions ?? []).map(
      (extension, index) =>
        [['extensions', index], extension as { familyId: string; targetId: string }] as const,
    ),
  ];
  for (const [path, descriptor] of targetLike) {
    if (descriptor.familyId !== family.familyId) {
      return ctx.reject({
        path: [...path, 'familyId'],
        expected: `Config.family.familyId (${family.familyId})`,
        actual: descriptor.familyId,
      });
    }
    if (descriptor.targetId !== target.targetId) {
      return ctx.reject({
        path: [...path, 'targetId'],
        expected: `Config.target.targetId (${target.targetId})`,
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
