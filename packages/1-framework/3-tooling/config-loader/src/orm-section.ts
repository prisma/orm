import type { PrismaNextConfig } from '@internal/config/config-types';
import { blindCast } from '@internal/utils/casts';
import type { ConfigSection as EngineConfigSection, SectionProvenance } from '@prisma/cli-engine';
import {
  configSchema,
  defineConfigSection,
  reference,
  validateSectionWithSchema,
} from '@prisma/cli-engine';

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

/**
 * The fields that identify a control descriptor. Only these are declared: a
 * descriptor is a runtime object the family builds, and its other members
 * (codec tables, the contract serializer, migration hooks) pass through. Each
 * descriptor is declared a reference, so the command receives the object the
 * config file built.
 */
const descriptorFields = {
  id: 'string',
  familyId: 'string',
  version: 'string',
  create: 'Function',
} as const;

const targetLikeFields = { ...descriptorFields, targetId: 'string' } as const;

/**
 * The contract source provider: `load` closes over the authored contract,
 * and `inputs` are paths the schema resolves against the config file. Other
 * keys a provider carries pass through.
 */
const contractSource = {
  load: 'Function',
  'inputs?': 'path[]',
  'format?': 'string',
} as const;

/** Each subsection's own shape, without the rules that relate subsections to one another. */
const ormSubsectionsSchema = configSchema({
  family: reference(configSchema({ kind: "'family'", ...descriptorFields, emission: 'object' })),
  target: reference(configSchema({ kind: "'target'", ...targetLikeFields })),
  adapter: reference(configSchema({ kind: "'adapter'", ...targetLikeFields })),
  'driver?': reference(configSchema({ kind: "'driver'", ...targetLikeFields })),
  'extensions?': [reference(configSchema({ kind: "'extension'", ...targetLikeFields })), '[]'],
  'db?': { 'connection?': reference(configSchema('unknown')) },
  'contract?': {
    source: contractSource,
    output: ['path', '=', () => 'src/prisma/contract.json'],
  },
  migrations: [{ dir: ['path', '=', () => './migrations'] }, '=', () => ({})],
  'formatter?': { 'indent?': "number.integer >= 1 | 'tab'", 'newline?': "'LF' | 'CRLF'" },
});

interface RelatedDescriptor {
  readonly familyId: string;
  readonly targetId: string;
}

/** The subsections the relationship rules read, each present only if it validated. */
interface DescriptorSubsections {
  readonly family?: { readonly familyId: string };
  readonly target?: RelatedDescriptor;
  readonly adapter?: RelatedDescriptor;
  readonly driver?: RelatedDescriptor | undefined;
  readonly extensions?: readonly RelatedDescriptor[] | undefined;
}

/** A broken rule relating two subsections, at the field that breaks it. */
export interface RelationshipProblem {
  readonly path: readonly PropertyKey[];
  readonly expected: string;
  readonly actual: string;
}

/**
 * Every broken rule relating the descriptor subsections: each descriptor
 * shares the family's `familyId`, and each target-bound descriptor shares
 * the target's `targetId`. A rule is checked only when `checked` accepts
 * both subsections it relates, so a loader can check the subsections that
 * validated while others have diagnostics.
 */
export function descriptorRelationshipProblems(
  config: DescriptorSubsections,
  checked: (section: ConfigSection) => boolean,
): RelationshipProblem[] {
  const family = checked('family') ? config.family : undefined;
  const target = checked('target') ? config.target : undefined;
  const bound: ReadonlyArray<readonly [readonly PropertyKey[], RelatedDescriptor | undefined]> = [
    [['target'], target],
    [['adapter'], checked('adapter') ? config.adapter : undefined],
    [['driver'], checked('driver') ? config.driver : undefined],
    ...(checked('extensions') ? (config.extensions ?? []) : []).map(
      (extension, index) => [['extensions', index], extension] as const,
    ),
  ];
  const problems: RelationshipProblem[] = [];
  for (const [path, descriptor] of bound) {
    if (descriptor === undefined) {
      continue;
    }
    if (family !== undefined && descriptor.familyId !== family.familyId) {
      problems.push({
        path: [...path, 'familyId'],
        expected: `Config.family.familyId (${family.familyId})`,
        actual: descriptor.familyId,
      });
    }
    if (target !== undefined && path[0] !== 'target' && descriptor.targetId !== target.targetId) {
      problems.push({
        path: [...path, 'targetId'],
        expected: `Config.target.targetId (${target.targetId})`,
        actual: descriptor.targetId,
      });
    }
  }
  return problems;
}

/**
 * The shape of the `orm` section of `prisma.config.ts`, declared once. The
 * CLI engine derives validation, the diagnostics naming a bad field and the
 * file to fix, and the resolution of every `path` field against the config
 * file that wrote it (prisma-cli ADR 0005). Relative paths are resolved
 * before any command sees the value, and the value carries `baseDir`.
 */
export const ormConfigSchema = ormSubsectionsSchema.narrow((config, ctx) => {
  if ('extensionPacks' in config) {
    return ctx.reject({
      path: ['extensionPacks'],
      message: 'Config.extensionPacks is no longer supported; rename it to Config.extensions',
    });
  }
  const problems = descriptorRelationshipProblems(config, () => true);
  for (const problem of problems) {
    ctx.error({ path: [...problem.path], expected: problem.expected, actual: problem.actual });
  }
  return problems.length === 0;
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

/**
 * Validates the shape of every subsection except `failing`, which comes back
 * as authored. A loader uses it when some subsections have diagnostics, so a
 * caller that reads only the others still gets their paths resolved and
 * defaults applied. The rules relating subsections are not applied here; see
 * {@link descriptorRelationshipProblems}.
 */
export function validateOrmSectionExcept(
  raw: unknown,
  provenance: SectionProvenance,
  failing: ReadonlySet<string>,
): ReturnType<typeof validateSectionWithSchema> {
  const healthy = CONFIG_SECTIONS.filter((section) => !failing.has(section));
  return validateSectionWithSchema(
    ORM_CONFIG_SECTION_NAME,
    ormSubsectionsSchema.pick(...healthy),
    raw,
    provenance,
  );
}
