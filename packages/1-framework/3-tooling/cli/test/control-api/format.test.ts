import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type * as configLoader from '@internal/config-loader';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { executeFormat, resolveNewline } from '../../src/control-api/operations/format';

function mockConfig(overrides: Record<string, unknown>) {
  return overrides as unknown as configLoader.PrismaNextConfig;
}

function pslConfig(
  inputPath: string,
  formatter?: { indent?: number | 'tab'; newline?: 'LF' | 'CRLF' },
) {
  return mockConfig({
    contract: {
      source: { format: 'psl', inputs: [inputPath], load: () => {} },
      output: join(inputPath, '..', 'contract.json'),
    },
    ...(formatter ? { formatter } : {}),
  });
}

const MESSY_PSL = 'model    User{id Int @id\nname String}\n';
const FORMATTED_PSL = `model User {
  id   Int    @id
  name String
}
`;

describe('resolveNewline', () => {
  it('explicit formatter newline wins over os EOL', () => {
    expect(resolveNewline('CRLF', '\n')).toBe('CRLF');
    expect(resolveNewline('LF', '\r\n')).toBe('LF');
  });

  it('falls back to os EOL mapping when newline is absent', () => {
    expect(resolveNewline(undefined, '\r\n')).toBe('CRLF');
    expect(resolveNewline(undefined, '\n')).toBe('LF');
  });
});

describe('executeFormat', () => {
  let tmpDir = '';

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'psl-format-'));
  });

  afterEach(async () => {
    if (tmpDir.length > 0) {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('formats a psl source file in place', async () => {
    const inputPath = join(tmpDir, 'schema.prisma');
    await writeFile(inputPath, MESSY_PSL, 'utf-8');

    const result = await executeFormat({
      config: pslConfig(inputPath),
      cwd: tmpDir,
      eol: '\n',
    });

    expect(result.ok).toBe(true);
    expect(await readFile(inputPath, 'utf-8')).toBe(FORMATTED_PSL);
  });

  it('leaves a typescript source untouched', async () => {
    const inputPath = join(tmpDir, 'contract.ts');
    const original = 'export const x = 1;\n';
    await writeFile(inputPath, original, 'utf-8');

    const result = await executeFormat({
      config: mockConfig({
        contract: {
          source: { format: 'typescript', inputs: [inputPath], load: () => {} },
          output: join(tmpDir, 'contract.json'),
        },
      }),
      cwd: tmpDir,
      eol: '\n',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.formatted).toBe(false);
    }
    expect(await readFile(inputPath, 'utf-8')).toBe(original);
  });

  it('leaves an absent-format source untouched', async () => {
    const inputPath = join(tmpDir, 'schema.prisma');
    await writeFile(inputPath, MESSY_PSL, 'utf-8');

    const result = await executeFormat({
      config: mockConfig({
        contract: {
          source: { inputs: [inputPath], load: () => {} },
          output: join(tmpDir, 'contract.json'),
        },
      }),
      cwd: tmpDir,
      eol: '\n',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.formatted).toBe(false);
    }
    expect(await readFile(inputPath, 'utf-8')).toBe(MESSY_PSL);
  });

  it('refuses unparseable psl without writing a partial file', async () => {
    const inputPath = join(tmpDir, 'schema.prisma');
    const broken = 'model {{{ broken\n';
    await writeFile(inputPath, broken, 'utf-8');

    const result = await executeFormat({
      config: pslConfig(inputPath),
      cwd: tmpDir,
      eol: '\n',
    });

    expect(result.ok).toBe(false);
    expect(await readFile(inputPath, 'utf-8')).toBe(broken);
  });

  it('returns a structured error when write-back fails', async () => {
    const inputPath = join(tmpDir, 'schema.prisma');
    await writeFile(inputPath, MESSY_PSL, 'utf-8');
    await chmod(inputPath, 0o444);

    try {
      const result = await executeFormat({
        config: pslConfig(inputPath),
        cwd: tmpDir,
        eol: '\n',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.failure.message).toBe('Failed to write formatted contract source file');
      }
      expect(await readFile(inputPath, 'utf-8')).toBe(MESSY_PSL);
    } finally {
      await chmod(inputPath, 0o644);
    }
  });
});
