import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { afterEach, describe, expect, it } from 'vitest';
import { expandContractInputs, globContractInputMatching } from '../src/expand-contract-inputs';

describe('expandContractInputs', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tempDirs) {
      await rm(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  async function createFixtureDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'expand-contract-inputs-'));
    tempDirs.push(dir);
    return dir;
  }

  it('returns an empty list for no patterns', async () => {
    expect(await expandContractInputs([])).toEqual([]);
  });

  it('returns an empty list when patterns is undefined', async () => {
    expect(await expandContractInputs(undefined)).toEqual([]);
  });

  it('returns an empty list when a glob matches nothing', async () => {
    const dir = await createFixtureDir();

    expect(await expandContractInputs([join(dir, '*.prisma')])).toEqual([]);
  });

  it('passes a nonexistent literal path through unchanged, no existence check', async () => {
    const dir = await createFixtureDir();
    const missing = join(dir, 'schema.prisma');

    expect(await expandContractInputs([missing])).toEqual([missing]);
  });

  it('passes an existing wildcard-free literal path through unchanged', async () => {
    const dir = await createFixtureDir();
    const file = join(dir, 'schema.prisma');
    await writeFile(file, 'model User {}\n', 'utf-8');

    expect(await expandContractInputs([file])).toEqual([file]);
  });

  it('passes a directory literal through unchanged, no directory expansion', async () => {
    const dir = await createFixtureDir();
    await writeFile(join(dir, 'a.prisma'), 'model A {}\n', 'utf-8');
    await writeFile(join(dir, 'b.prisma'), 'model B {}\n', 'utf-8');

    expect(await expandContractInputs([dir])).toEqual([dir]);
  });

  it('expands a glob matching a directory to its files only, never the directory itself', async () => {
    const dir = await createFixtureDir();
    await mkdir(join(dir, 'nested'), { recursive: true });
    const file = join(dir, 'nested', 'schema.prisma');
    await writeFile(file, 'model User {}\n', 'utf-8');

    expect(await expandContractInputs([join(dir, '**')])).toEqual([file]);
  });

  it('dedupes a file matched by two overlapping globs', async () => {
    const dir = await createFixtureDir();
    await mkdir(join(dir, 'nested'), { recursive: true });
    const file = join(dir, 'nested', 'schema.prisma');
    await writeFile(file, 'model User {}\n', 'utf-8');

    const result = await expandContractInputs([
      join(dir, '**/*.prisma'),
      join(dir, 'nested/*.prisma'),
    ]);

    expect(result).toEqual([file]);
  });

  it('sorts the result independent of filesystem enumeration order', async () => {
    const dir = await createFixtureDir();
    const zebra = join(dir, 'zebra.prisma');
    const alpha = join(dir, 'alpha.prisma');
    await writeFile(zebra, 'model Z {}\n', 'utf-8');
    await writeFile(alpha, 'model A {}\n', 'utf-8');

    expect(await expandContractInputs([join(dir, '*.prisma')])).toEqual([alpha, zebra]);
  });

  it('combines matches from multiple non-overlapping globs, sorted together', async () => {
    const dir = await createFixtureDir();
    await mkdir(join(dir, 'a'), { recursive: true });
    await mkdir(join(dir, 'b'), { recursive: true });
    const first = join(dir, 'a', 'one.prisma');
    const second = join(dir, 'b', 'two.prisma');
    await writeFile(first, 'model One {}\n', 'utf-8');
    await writeFile(second, 'model Two {}\n', 'utf-8');

    const result = await expandContractInputs([join(dir, 'a/*.prisma'), join(dir, 'b/*.prisma')]);

    expect(result).toEqual([first, second]);
  });

  it('passes a Windows UNC literal through byte-intact, without collapsing the authority', async () => {
    const uncPath = '\\\\server\\share\\schema.prisma';

    expect(await expandContractInputs([uncPath])).toEqual([uncPath]);
  });

  it('passes a forward-slash-normalized UNC literal through byte-intact', async () => {
    const uncPath = '//server/share/schema.prisma';

    expect(await expandContractInputs([uncPath])).toEqual([uncPath]);
  });

  it('reaches resolvedInputs intact through the same assembly every emit consumer uses', async () => {
    const dir = await createFixtureDir();
    const ordinary = join(dir, 'schema.prisma');
    await writeFile(ordinary, 'model User {}\n', 'utf-8');
    const uncPath = '\\\\server\\share\\sibling.prisma';

    const resolvedInputs = await expandContractInputs([ordinary, uncPath]);

    expect(resolvedInputs).toEqual([ordinary, uncPath].sort());
  });
});

describe('globContractInputMatching', () => {
  it('returns the glob input a path that does not exist yet would match', () => {
    expect(
      globContractInputMatching(
        ['/app/prisma/schema.prisma', '/app/prisma/**/*.prisma'],
        '/app/prisma/contract.prisma',
      ),
    ).toBe('/app/prisma/**/*.prisma');
  });

  it('returns nothing for a path no glob input matches', () => {
    expect(
      globContractInputMatching(['/app/prisma/**/*.prisma'], '/app/printed/contract.prisma'),
    ).toBeUndefined();
    expect(
      globContractInputMatching(['/app/prisma/**/*.prisma'], '/app/prisma/contract.json'),
    ).toBeUndefined();
  });

  it('does not treat an input with no wildcard as a glob', () => {
    expect(
      globContractInputMatching(['/app/prisma/contract.prisma'], '/app/prisma/contract.prisma'),
    ).toBeUndefined();
  });
});
