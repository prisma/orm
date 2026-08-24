import type { PrismaNextConfig } from '@internal/config/config-types';
import type { ConfigValidationIssue } from '@internal/config/config-validation';
import { collectConfigIssues } from '@internal/config/config-validation';
import { getEmittedArtifactPaths } from '@internal/emitter';
import { blindCast } from '@internal/utils/casts';
import type { SectionValidation } from '@prisma/cli-engine';
import { defineConfigSection } from '@prisma/cli-engine';
import type { Diagnostic, NextAction } from '@prisma/cli-engine/protocol';
import { normalize } from 'pathe';

/**
 * The single config section the `orm` command family owns. The whole Prisma
 * Next configuration is nested under it, so its subsections
 * (`contract`, `db`, `migrations`, …) are subsections of `orm`.
 */
export const ORM_CONFIG_SECTION_NAME = 'orm';

const MISSING_CONFIG_ACTION: NextAction = {
  kind: 'run-command',
  label: 'Create a config file',
  command: '{bin} orm init',
};

function editConfigAction(field: string): NextAction {
  return { kind: 'edit-file', label: `Correct ${field} in prisma.config.ts` };
}

function issueDiagnostic(issue: ConfigValidationIssue): Diagnostic {
  return {
    code: 'CONFIG.VALIDATION_FAILED',
    severity: 'error',
    summary: issue.message,
    why: issue.message,
    nextActions: [editConfigAction(issue.field)],
    meta: { field: issue.field, section: issue.section },
  };
}

function sectionAbsentDiagnostic(): Diagnostic {
  return {
    code: 'CONFIG.FILE_NOT_FOUND',
    severity: 'error',
    summary: 'No Prisma Next configuration was loaded',
    why: `The ${ORM_CONFIG_SECTION_NAME} config section is absent, so prisma.config.ts was never evaluated.`,
    nextActions: [MISSING_CONFIG_ACTION],
  };
}

function notAnObjectDiagnostic(): Diagnostic {
  return {
    code: 'CONFIG.VALIDATION_FAILED',
    severity: 'error',
    summary: 'Prisma Next configuration must be an object',
    why: `The ${ORM_CONFIG_SECTION_NAME} config section is not an object, so no section can be read from it.`,
    nextActions: [
      { kind: 'edit-file', label: 'Export a configuration object from prisma.config.ts' },
    ],
  };
}

function unreadableDiagnostic(error: unknown): Diagnostic {
  return {
    code: 'CONFIG.VALIDATION_FAILED',
    severity: 'error',
    summary: 'Prisma Next configuration could not be inspected',
    why: error instanceof Error ? error.message : String(error),
    nextActions: [
      {
        kind: 'edit-file',
        label: 'Export a plain configuration object from prisma.config.ts',
      },
    ],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * An emitted artifact listed as its own contract input makes every emit
 * consume its previous output. Structural, filesystem-free, and therefore the
 * section validator's business rather than the loader's.
 */
function collectArtifactCollisionIssues(
  raw: Record<string, unknown>,
): readonly ConfigValidationIssue[] {
  const contract = raw['contract'];
  if (!isRecord(contract)) {
    return [];
  }
  const source = contract['source'];
  const output = contract['output'];
  if (!isRecord(source) || typeof output !== 'string') {
    return [];
  }
  const inputs = source['inputs'];
  if (!Array.isArray(inputs)) {
    return [];
  }

  let emitted: ReturnType<typeof getEmittedArtifactPaths>;
  try {
    emitted = getEmittedArtifactPaths(output);
  } catch (error) {
    return [
      {
        section: 'contract',
        field: 'contract.output',
        message: error instanceof Error ? error.message : String(error),
      },
    ];
  }

  // `./out/contract.json` and `out/contract.json` are the same file, so the
  // comparison is between normalized spellings rather than raw strings.
  const emittedPaths = new Set([normalize(emitted.jsonPath), normalize(emitted.dtsPath)]);
  if (!inputs.some((input) => typeof input === 'string' && emittedPaths.has(normalize(input)))) {
    return [];
  }
  return [
    {
      section: 'contract',
      field: 'contract.source.inputs[]',
      message:
        'Config.contract.source.inputs must not include emitted artifact paths derived from contract.output',
    },
  ];
}

function validate(raw: unknown): SectionValidation<PrismaNextConfig> {
  if (raw === undefined) {
    return { ok: false as const, diagnostics: [sectionAbsentDiagnostic()] };
  }
  if (!isRecord(raw)) {
    return { ok: false as const, diagnostics: [notAnObjectDiagnostic()] };
  }

  let issues: readonly ConfigValidationIssue[];
  try {
    issues = [...collectConfigIssues(raw), ...collectArtifactCollisionIssues(raw)];
  } catch (error) {
    return { ok: false as const, diagnostics: [unreadableDiagnostic(error)] };
  }

  if (issues.length > 0) {
    return { ok: false as const, diagnostics: issues.map(issueDiagnostic) };
  }

  return {
    ok: true as const,
    value: blindCast<
      PrismaNextConfig,
      'collectConfigIssues found no structural problem, so every required section is present and well-typed'
    >(raw),
    diagnostics: [],
  };
}

export const ormConfigSection = defineConfigSection<PrismaNextConfig>({
  name: ORM_CONFIG_SECTION_NAME,
  validate,
});
