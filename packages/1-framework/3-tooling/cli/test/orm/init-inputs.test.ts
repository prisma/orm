import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { PromptSurface } from '@prisma/cli-engine';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type InitFlagValues, resolveInitInputs } from '../../src/orm/init-inputs';

let projectDir: string;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'orm-init-inputs-'));
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

function flags(overrides: Partial<InitFlagValues> = {}): InitFlagValues {
  return {
    target: 'postgres',
    authoring: 'psl',
    schemaPath: undefined,
    writeEnv: true,
    probeDb: false,
    strictProbe: false,
    skipInstall: true,
    keepPreviousFacade: false,
    ...overrides,
  };
}

interface TextCall {
  readonly question: string;
  readonly opts: { readonly placeholder?: string; readonly default?: string } | undefined;
}

function recordingPrompt(): { readonly prompt: PromptSurface; readonly textCalls: TextCall[] } {
  const textCalls: TextCall[] = [];
  const prompt: PromptSurface = {
    confirm: async () => false,
    consent: async () => false,
    select: async () => {
      throw new Error('unexpected select prompt');
    },
    text: async (question, opts) => {
      textCalls.push({ question, opts });
      return opts?.default ?? '';
    },
    browserWait: async () => undefined,
  };
  return { prompt, textCalls };
}

describe('the schema-path prompt', () => {
  it('passes the default schema path as both placeholder and default', async () => {
    const { prompt, textCalls } = recordingPrompt();

    const inputs = await resolveInitInputs({ cwd: projectDir, flags: flags(), prompt });

    expect(textCalls).toEqual([
      {
        question: 'Where should the schema file go?',
        opts: { placeholder: 'src/prisma/contract.prisma', default: 'src/prisma/contract.prisma' },
      },
    ]);
    expect(inputs.schemaPath).toBe('src/prisma/contract.prisma');
  });

  it('offers the TypeScript default under typescript authoring', async () => {
    const { prompt, textCalls } = recordingPrompt();

    const inputs = await resolveInitInputs({
      cwd: projectDir,
      flags: flags({ authoring: 'typescript' }),
      prompt,
    });

    expect(textCalls[0]?.opts).toEqual({
      placeholder: 'src/prisma/contract.ts',
      default: 'src/prisma/contract.ts',
    });
    expect(inputs.schemaPath).toBe('src/prisma/contract.ts');
  });
});
