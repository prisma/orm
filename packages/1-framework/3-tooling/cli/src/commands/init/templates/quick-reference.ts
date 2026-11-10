import {
  type ImportSpecifierResolver,
  keepInternalSpecifiers,
} from '@internal/framework-components/emission';
import { dirname } from 'pathe';
import {
  type AuthoringId,
  schemaSample,
  type TargetId,
  targetEntrypoint,
  targetPackageName,
} from './code-templates';
import { MIN_SERVER_VERSION, TARGET_LABEL } from './env';
import { renderTemplate } from './render';

export const variables = [
  'schemaPath',
  'schemaDir',
  'dbImportPath',
  'pkgRun',
  'pkg',
  'configEntrypoint',
  'schemaSample',
  'requirements',
] as const;

type TemplateVars = Record<(typeof variables)[number], string>;

export function quickReferenceMd(
  target: TargetId,
  authoring: AuthoringId,
  schemaPath: string,
  pkgRun: string,
  resolveImportSpecifier: ImportSpecifierResolver = keepInternalSpecifiers,
): string {
  const schemaDir = dirname(schemaPath);
  const pkg = targetPackageName(target, resolveImportSpecifier);
  const vars: TemplateVars = {
    schemaPath,
    schemaDir,
    dbImportPath: `./${schemaDir}/db`,
    pkgRun,
    pkg,
    configEntrypoint: targetEntrypoint(target, 'config', resolveImportSpecifier),
    schemaSample: schemaSample(target, authoring, resolveImportSpecifier),
    requirements: requirementsBlock(target, pkgRun),
  };
  const templateFile = `quick-reference-${target}.md`;
  return renderTemplate(templateFile, variables, vars);
}

/**
 * Renders the FR8.2 "Requirements" block injected into `prisma-8.md`
 * (the user-facing quick reference). Sources the minimum server
 * version from `MIN_SERVER_VERSION` — itself mirrored from each
 * target package's `package.json#prismaNext.minServerVersion`
 * (FR8.1).
 *
 * The verification command is target-specific — Postgres scaffolds
 * shouldn't ship Mongo's `db.runCommand` (and vice versa) just because
 * we couldn't be bothered to branch.
 */
function requirementsBlock(target: TargetId, pkgRun: string): string {
  const label = TARGET_LABEL[target];
  const minVersion = MIN_SERVER_VERSION[target];
  const verifyCommand =
    target === 'postgres' ? '`SELECT version()`' : '`db.runCommand({ buildInfo: 1 })`';
  return [
    '## Requirements',
    '',
    `- **${label} ${minVersion} or newer.** Older servers are not supported. Run ${verifyCommand} against your server to verify.`,
    `- The CLI never connects to your database without explicit consent. Pass \`--probe-db\` to \`${pkgRun} orm init\` if you want \`init\` to verify the server version itself.`,
  ].join('\n');
}

export const prisma7Variables = [
  'schemaPath',
  'outputDir',
  'dbImportPath',
  'pkgRun',
  'pkg',
  'configEntrypoint',
  'requirements',
  'prisma7ConfigSentence',
  'prisma7ConfigRow',
] as const;

/** The quick reference for a project whose contract source is its Prisma 7 schema. */
export function prisma7QuickReferenceMd(
  target: TargetId,
  schemaPath: string,
  outputDir: string,
  pkgRun: string,
  prisma7Config: string | undefined,
  resolveImportSpecifier: ImportSpecifierResolver = keepInternalSpecifiers,
): string {
  const vars: Record<(typeof prisma7Variables)[number], string> = {
    schemaPath,
    outputDir,
    dbImportPath: `./${outputDir}/db`,
    pkgRun,
    pkg: targetPackageName(target, resolveImportSpecifier),
    configEntrypoint: targetEntrypoint(target, 'config', resolveImportSpecifier),
    requirements: requirementsBlock(target, pkgRun),
    prisma7ConfigSentence:
      prisma7Config === undefined
        ? ''
        : ` Prisma 7 reads its own config from \`${prisma7Config}\`.`,
    prisma7ConfigRow:
      prisma7Config === undefined
        ? ''
        : `\n| [\`${prisma7Config}\`](${prisma7Config}) | Prisma 7 CLI configuration |`,
  };
  return renderTemplate('quick-reference-prisma7.md', prisma7Variables, vars);
}
