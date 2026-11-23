import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'pathe';
import { describe, expect, it } from 'vitest';
import { configWithContract, inDirectory, passOutput, useGenerateProjects } from './projects';
import { appPsl, twoFactorCode, twoFactorSummary } from './sources';

const { fixture, projectWith, generate, refusalFor } = useGenerateProjects();

describe('createSchema for auth generate', () => {
  it('returns the absolute path of the file --output names, which Better Auth writes whatever its --cwd', async () => {
    const dir = await projectWith({ 'prisma/contract.prisma': appPsl });
    const file = join(dir, 'prisma/contract.prisma');
    const generated = await generate(file);
    const fileName = generated.schema?.path ?? '';
    const betterAuthCwd = fixture().workDir.nextPath('cwd');
    await writeFile(
      isAbsolute(fileName) ? fileName : join(betterAuthCwd, fileName),
      generated.schema?.code ?? '',
    );
    expect({ ...generated, written: await readFile(file, 'utf8') }).toEqual({
      schema: { code: twoFactorCode, path: file, overwrite: true },
      printed: [[twoFactorSummary(relative(process.cwd(), file))]],
      written: twoFactorCode,
    });
  });

  it('shows the absolute path for a file outside the working directory', async () => {
    const dir = fixture().workDir.nextPath('outside');
    await mkdir(dir, { recursive: true });
    const file = join(dir, 'contract.prisma');
    await writeFile(file, appPsl);
    expect(await generate(file)).toEqual({
      schema: { code: twoFactorCode, path: file, overwrite: true },
      printed: [[twoFactorSummary(file)]],
    });
  });

  it('finds the contract through prisma.config.ts in the working directory', async () => {
    const dir = await projectWith({
      'prisma.config.ts': configWithContract("{ contract: './prisma/contract.prisma' }"),
      'prisma/contract.prisma': appPsl,
    });
    expect(await inDirectory(dir, () => generate())).toEqual({
      schema: { code: twoFactorCode, path: join(dir, 'prisma/contract.prisma'), overwrite: true },
      printed: [[twoFactorSummary('prisma/contract.prisma')]],
    });
  });

  it('skips a file the config matches that is not a Prisma 8 contract, as emitting does', async () => {
    const dir = await projectWith({
      'prisma.config.ts': configWithContract("{ contract: './prisma/*.prisma' }"),
      'prisma/contract.prisma': appPsl,
      'prisma/schema.prisma': 'model Old {\n  id Int @id\n}\n',
    });
    expect(await inDirectory(dir, () => generate())).toEqual({
      schema: { code: twoFactorCode, path: join(dir, 'prisma/contract.prisma'), overwrite: true },
      printed: [[twoFactorSummary('prisma/contract.prisma')]],
    });
  });

  it('prints the message for a contract read from a Prisma 7 schema', async () => {
    const dir = await projectWith({
      'prisma.config.ts': `import { definePrismaConfig } from '@prisma/cli-engine';
import { defineConfig } from '@prisma/orm-sqlite/config';

const orm = defineConfig({ contract: './prisma/schema.prisma' });
const source = { ...orm.contract.source, parserOptions: { grammar: 'prisma-7' } };

export default definePrismaConfig({ orm: { ...orm, contract: { ...orm.contract, source } } });
`,
      'prisma/schema.prisma': 'model User {\n  id String @id\n}\n',
    });
    const expected = await refusalFor(
      '`auth generate` did not change your contract, because it is a Prisma 7 schema, and the lines above are Prisma 8 syntax. Add the equivalent lines by hand.',
    );
    await expect(inDirectory(dir, () => generate())).rejects.toThrow(expected);
  });

  it('prints the message when there is neither --output nor prisma.config.ts', async () => {
    const dir = await projectWith({ 'prisma/contract.prisma': appPsl });
    const expected = await refusalFor(
      `\`auth generate\` did not change your contract, because it found no prisma.config.ts in the working directory. ${passOutput}`,
    );
    await expect(inDirectory(dir, () => generate())).rejects.toThrow(expected);
  });

  it('prints the message when prisma.config.ts names no contract', async () => {
    const dir = await projectWith({
      'prisma.config.ts':
        "import { definePrismaConfig } from '@prisma/cli-engine';\n\nexport default definePrismaConfig({});\n",
    });
    const expected = await refusalFor(
      `\`auth generate\` did not change your contract, because prisma.config.ts names no contract. ${passOutput}`,
    );
    await expect(inDirectory(dir, () => generate())).rejects.toThrow(expected);
  });

  it('prints the message when the contract inputs prisma.config.ts names match no file', async () => {
    const dir = await projectWith({
      'prisma.config.ts': configWithContract("{ contract: './prisma/*.prisma' }"),
    });
    const expected = await refusalFor(
      `\`auth generate\` did not change your contract, because the contract inputs prisma.config.ts names match no file: prisma/*.prisma. ${passOutput}`,
    );
    await expect(inDirectory(dir, () => generate())).rejects.toThrow(expected);
  });

  it('prints the message when none of the files prisma.config.ts names starts with the Prisma 8 line', async () => {
    const dir = await projectWith({
      'prisma.config.ts': configWithContract("{ contract: './prisma/*.prisma' }"),
      'prisma/schema.prisma': 'model Old {\n  id Int @id\n}\n',
    });
    const expected = await refusalFor(
      `\`auth generate\` did not change your contract, because none of the files prisma.config.ts names starts with \`// use prisma-8\`. ${passOutput}`,
    );
    await expect(inDirectory(dir, () => generate())).rejects.toThrow(expected);
  });

  it('prints the message when prisma.config.ts does not load', async () => {
    const dir = await projectWith({ 'prisma.config.ts': "throw new Error('broken config');\n" });
    const expected = await refusalFor(
      `\`auth generate\` did not change your contract, because prisma.config.ts did not load: Config file could not be evaluated. ${passOutput}`,
    );
    await expect(inDirectory(dir, () => generate())).rejects.toThrow(expected);
  });

  it('prints the message when prisma.config.ts names a contract written in TypeScript', async () => {
    const dir = await projectWith({
      'prisma.config.ts': configWithContract("{ contract: './prisma/contract.ts' }"),
      'prisma/contract.ts': 'export {};\n',
    });
    const expected = await refusalFor(
      '`auth generate` did not change your contract, because it is written in TypeScript. Add the equivalent models and fields in TypeScript.',
    );
    await expect(inDirectory(dir, () => generate())).rejects.toThrow(expected);
  });

  it('prints the message when the file --output names does not exist, and creates nothing', async () => {
    const dir = await projectWith({});
    const file = join(dir, 'prisma/contract.prisma');
    const expected = await refusalFor(
      `\`auth generate\` did not change your contract, because ${relative(process.cwd(), file)} was not found. ${passOutput}`,
    );
    await expect(generate(file)).rejects.toThrow(expected);
    await expect(readFile(file)).rejects.toThrow('ENOENT');
  });

  it('prints the message when the file --output names cannot be read', async () => {
    const dir = await projectWith({ 'prisma/contract.prisma/keep': '' });
    const file = join(dir, 'prisma/contract.prisma');
    const expected = await refusalFor(
      `\`auth generate\` did not change your contract, because ${relative(process.cwd(), file)} could not be read: EISDIR: illegal operation on a directory, read '${file}'. ${passOutput}`,
    );
    await expect(generate(file)).rejects.toThrow(expected);
  });

  it('prints the message for a contract written in TypeScript', async () => {
    const dir = await projectWith({ 'prisma/contract.ts': 'export {};\n' });
    const expected = await refusalFor(
      '`auth generate` did not change your contract, because it is written in TypeScript. Add the equivalent models and fields in TypeScript.',
    );
    await expect(generate(join(dir, 'prisma/contract.ts'))).rejects.toThrow(expected);
  });
});
