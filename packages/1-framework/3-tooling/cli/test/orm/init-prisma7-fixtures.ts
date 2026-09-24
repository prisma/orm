import { mkdirSync, writeFileSync } from 'node:fs';
import type { PromptSurface } from '@prisma/cli-engine';
import { dirname, join } from 'pathe';
import { type InitFlagValues, resolveInitInputs } from '../../src/orm/init-inputs';
import type { CheckPrisma7Source, Prisma7SourceCheck } from '../../src/orm/init-prisma7-check';

export function flags(overrides: Partial<InitFlagValues> = {}): InitFlagValues {
  return {
    target: undefined,
    authoring: undefined,
    schemaPath: undefined,
    writeEnv: true,
    probeDb: false,
    strictProbe: false,
    skipInstall: true,
    keepPreviousFacade: false,
    fromPrisma7Schema: undefined,
    ...overrides,
  };
}

export const PRISMA7_POSTGRES_SCHEMA =
  'datasource db {\n  provider = "postgresql"\n}\nmodel User {\n  id String @id\n}\n';
export const PRISMA7_CONFIG = "export default { schema: 'prisma/schema.prisma' };\n";
export const PRISMA8_CONFIG = 'export default { $prismaConfig: 1, orm: {} };\n';
export const PRISMA7_QUESTION =
  'prisma/schema.prisma is a Prisma 7 schema. Use it as the Prisma 8 contract source?';
export const SIDE_BY_SIDE_QUESTION =
  'Prisma 7 is installed as `prisma`. Keep it as @prisma/prisma7 (binary prisma7) and move `prisma` to Prisma 8?';

export interface PromptCall {
  readonly kind: 'confirm' | 'consent' | 'select' | 'text';
  readonly question: string;
  readonly opts: unknown;
}

function promptRequired(question: string): Error {
  return Object.assign(new Error(`cannot ask "${question}"`), { code: 'CLI.PROMPT_REQUIRED' });
}

/**
 * Answers prompts from a script keyed by question text. A question with no
 * scripted answer takes its default; a `confirm` with neither throws the
 * engine's PROMPT_REQUIRED, the way a non-interactive session does.
 */
export function scriptedPrompt(answers: Record<string, unknown> = {}): {
  readonly prompt: PromptSurface;
  readonly calls: PromptCall[];
} {
  const calls: PromptCall[] = [];
  const answer = (question: string): unknown => answers[question];
  const prompt: PromptSurface = {
    confirm: async (question, opts) => {
      calls.push({ kind: 'confirm', question, opts });
      const scripted = answer(question) ?? opts?.default;
      if (scripted === undefined) throw promptRequired(question);
      return scripted === true;
    },
    consent: async (question, opts) => {
      calls.push({ kind: 'consent', question, opts });
      return answer(question) === true;
    },
    select: async (question, options, opts) => {
      calls.push({ kind: 'select', question, opts });
      const scripted = answer(question) ?? opts?.default;
      const match = options.find((option) => option.value === scripted);
      if (match === undefined) throw promptRequired(question);
      return match.value;
    },
    text: async (question, opts) => {
      calls.push({ kind: 'text', question, opts });
      return opts?.default ?? '';
    },
    browserWait: async () => undefined,
  };
  return { prompt, calls };
}

export function projectFiles(projectDir: () => string) {
  const write = (relative: string, content: string): void => {
    mkdirSync(join(projectDir(), dirname(relative)), { recursive: true });
    writeFileSync(join(projectDir(), relative), content, 'utf-8');
  };
  return {
    write,
    writePrisma7Schema: (provider = 'postgresql', path = 'prisma/schema.prisma'): void => {
      write(path, PRISMA7_POSTGRES_SCHEMA.replace('postgresql', provider));
    },
    writeManifest: (manifest: Record<string, unknown>): void => {
      write('package.json', `${JSON.stringify(manifest, null, 2)}\n`);
    },
  };
}

export const STUB_PACKAGE = 'stub-target-package';

/** A check that reports `outcome` and records each request it receives. */
export function stubCheck(
  outcome: Partial<Prisma7SourceCheck> = {},
): CheckPrisma7Source & { readonly requests: Parameters<CheckPrisma7Source>[0][] } {
  const requests: Parameters<CheckPrisma7Source>[0][] = [];
  const check = async (request: Parameters<CheckPrisma7Source>[0]) => {
    requests.push(request);
    return {
      outcome: 'readable' as const,
      packageName: STUB_PACKAGE,
      installed: [],
      added: undefined,
      warnings: [],
      ...outcome,
    };
  };
  return Object.assign(check, { requests });
}

type ResolveContext = Parameters<typeof resolveInitInputs>[0];

/** Input resolution with a check that reads every schema and no warning sink, unless the test supplies its own. */
export function resolveInputs(
  ctx: Omit<ResolveContext, 'checkPrisma7Source' | 'warn'> & {
    readonly checkPrisma7Source?: CheckPrisma7Source;
    readonly warn?: ResolveContext['warn'];
  },
) {
  return resolveInitInputs({ checkPrisma7Source: stubCheck(), warn: () => {}, ...ctx });
}
