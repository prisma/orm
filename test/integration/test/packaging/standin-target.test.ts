import { execFileSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { publicShells, type ShellName } from '@internal/publish-surface/shells';
import { installShells, type PackedShell, packShell } from '@repo/tsdown/shell-testkit';
import ts from 'typescript';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generatedImportProblems, importedModules } from './generated-imports';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'standin');
const workspaceVersion = (
  JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as { version: string }
).version;
const typescriptVersion = ts.version;
const cliEngineVersion = (
  JSON.parse(
    readFileSync(join(repoRoot, 'packages/9-public/@prisma/orm-toolchain/package.json'), 'utf8'),
  ) as { peerDependencies: Record<string, string> }
).peerDependencies['@prisma/cli-engine'];

const STANDIN = 'prisma-orm-standin';
const TYPES_MODULE = `${STANDIN}/contract-types`;
const MIGRATION_MODULE = `${STANDIN}/migration`;
const EXTENSION = '@prisma/orm-extension-pgvector';
const TOOLCHAIN = '@prisma/orm-toolchain';
const FRAMEWORK = '@prisma/orm-framework';
const TARGET = '@prisma/orm-target-postgres';
const RUNTIME = '@prisma/orm-postgres';
const shells: ShellName[] = [
  '@prisma/orm-framework',
  '@prisma/orm-toolchain',
  '@prisma/orm-family-sql',
  '@prisma/orm-target-postgres',
  '@prisma/orm-postgres',
  '@prisma/orm-extension-pgvector',
];

/** What init's own install would add beside the stand-in; the run under `--skip-install` needs them in place. */
const INIT_INSTALLS = { dotenv: '^17.4.2', '@types/node': '^24.10.4' };

const CONTRACT = `// use prisma-8

model User {
  id    Int    @id @default(autoincrement())
  email String @unique
}
`;

const CONTRACT_WITH_VECTOR = `// use prisma-8

types {
  Embedding = pgvector.Vector(3)
}

model Document {
  id        Int       @id @default(autoincrement())
  embedding Embedding
}
`;

const CLI_RUNNER = `import { runOrmBin } from '${TOOLCHAIN}/cli';

await runOrmBin();
`;

const CONTRACT_IS_TYPED = `import type { Contract } from './prisma/contract';

type IsAny<T> = 0 extends 1 & T ? true : false;
export const contractIsTyped: IsAny<Contract> = false;
`;

function packShells(scratch: string): PackedShell[] {
  return shells.map((name) => {
    const shell = publicShells.get(name);
    if (shell === undefined) throw new Error(`unknown shell ${name}`);
    return packShell(join(repoRoot, shell.dir), scratch);
  });
}

function standinManifest(): string {
  const manifest: { dependencies: Record<string, string> } = JSON.parse(
    readFileSync(join(fixtureDir, 'package.template.json'), 'utf8'),
  );
  for (const name of Object.keys(manifest.dependencies)) {
    manifest.dependencies[name] = workspaceVersion;
  }
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function buildStandin(scratch: string, packed: readonly PackedShell[]): PackedShell {
  const buildDir = join(scratch, 'standin-build');
  installShells(buildDir, packed, {
    direct: ['@prisma/orm-framework', '@prisma/orm-family-sql', TARGET, RUNTIME, TOOLCHAIN],
    registryDependencies: { typescript: typescriptVersion },
  });
  cpSync(join(fixtureDir, 'src'), join(buildDir, 'src'), { recursive: true });
  cpSync(join(fixtureDir, 'tsconfig.json'), join(buildDir, 'tsconfig.json'));
  execFileSync(join(buildDir, 'node_modules', '.bin', 'tsc'), ['-p', 'tsconfig.json'], {
    cwd: buildDir,
    stdio: 'pipe',
  });

  const packageDir = join(scratch, 'standin-package');
  mkdirSync(packageDir, { recursive: true });
  cpSync(join(buildDir, 'dist'), join(packageDir, 'dist'), { recursive: true });
  writeFileSync(join(packageDir, 'package.json'), standinManifest());
  const tarball = join(scratch, 'prisma-orm-standin-1.0.0.tgz');
  execFileSync('pnpm', ['pack', '--out', tarball], { cwd: packageDir, stdio: 'pipe' });
  return { name: STANDIN, tarball, override: false };
}

interface Application {
  readonly dir: string;
  readonly directDependencies: readonly string[];
  readonly extensionPackages: readonly string[];
  run(...args: string[]): void;
  runNode(file: string): void;
  read(path: string): string;
  generatedFiles(): string[];
}

/**
 * An application set up by `prisma orm init --target <the stand-in>`, which writes its config,
 * contract source, `db.ts` and `tsconfig.json` from the stand-in's init contribution.
 */
function createInitApplication(dir: string, packed: readonly PackedShell[]): Application {
  installShells(dir, packed, {
    direct: [STANDIN, TOOLCHAIN, FRAMEWORK],
    registryDependencies: {
      '@prisma/cli-engine': cliEngineVersion ?? '',
      typescript: typescriptVersion,
      ...INIT_INSTALLS,
    },
  });
  writeFileSync(join(dir, 'prisma-cli.mjs'), CLI_RUNNER);
  runNodeIn(dir, [
    'prisma-cli.mjs',
    'orm',
    'init',
    '--target',
    STANDIN,
    '--authoring',
    'psl',
    '--yes',
    '--skip-install',
  ]);
  writeFileSync(join(dir, 'src', 'contract-is-typed.ts'), CONTRACT_IS_TYPED);
  return applicationIn(dir, { extensionPackages: [] });
}

function createApplication(
  dir: string,
  packed: readonly PackedShell[],
  options: { readonly withExtension: boolean },
): Application {
  const fromTarballs = [
    STANDIN,
    TOOLCHAIN,
    FRAMEWORK,
    ...(options.withExtension ? [EXTENSION, TARGET, '@prisma/orm-family-sql'] : []),
  ];
  const fromRegistry = {
    '@prisma/cli-engine': cliEngineVersion ?? '',
    typescript: typescriptVersion,
  };
  installShells(dir, packed, { direct: fromTarballs, registryDependencies: fromRegistry });

  const extensionImport = options.withExtension
    ? `import pgvector from '${EXTENSION}/control';\n`
    : '';
  writeFileSync(
    join(dir, 'prisma.config.ts'),
    `import { definePrismaConfig } from '@prisma/cli-engine';
import { defineConfig } from '${STANDIN}/config';
${extensionImport}
export default definePrismaConfig({
  orm: defineConfig({
    contract: './src/prisma/contract.prisma',
    output: './src/prisma/contract.json',
    extensions: [${options.withExtension ? 'pgvector' : ''}],
  }),
});
`,
  );
  mkdirSync(join(dir, 'src', 'prisma'), { recursive: true });
  writeFileSync(
    join(dir, 'src', 'prisma', 'contract.prisma'),
    options.withExtension ? CONTRACT_WITH_VECTOR : CONTRACT,
  );
  writeFileSync(join(dir, 'src', 'contract-is-typed.ts'), CONTRACT_IS_TYPED);
  writeFileSync(join(dir, 'prisma-cli.mjs'), CLI_RUNNER);
  return applicationIn(dir, { extensionPackages: options.withExtension ? [EXTENSION] : [] });
}

function applicationIn(
  dir: string,
  options: { readonly extensionPackages: readonly string[] },
): Application {
  const directDependencies = Object.keys(
    (
      JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
        dependencies: Record<string, string>;
      }
    ).dependencies,
  );
  return {
    dir,
    directDependencies,
    extensionPackages: options.extensionPackages,
    run(...args) {
      runNodeIn(dir, ['prisma-cli.mjs', ...args]);
    },
    runNode(file) {
      runNodeIn(dir, [file]);
    },
    read(path) {
      return readFileSync(join(dir, path), 'utf8');
    },
    generatedFiles() {
      return readdirSync(dir, { recursive: true, encoding: 'utf8' })
        .filter((file) => !file.startsWith('node_modules'))
        .filter(
          (file) => file.endsWith('contract.d.ts') || /migrations\/.*migration\.ts$/.test(file),
        )
        .sort();
    },
  };
}

function runNodeIn(dir: string, args: readonly string[]): void {
  try {
    execFileSync(process.execPath, args, {
      cwd: dir,
      stdio: 'pipe',
      env: { ...process.env, NO_COLOR: '1', CI: 'true' },
    });
  } catch (error) {
    const output =
      error instanceof Error && 'stdout' in error && 'stderr' in error
        ? `${String(error.stdout)}\n${String(error.stderr)}`
        : String(error);
    throw new Error(`node ${args.join(' ')} failed in ${dir}:\n${output}`);
  }
}

function typecheck(app: Application): string[] {
  const roots = [...app.generatedFiles(), 'src/contract-is-typed.ts'].map((file) =>
    join(app.dir, file),
  );
  const program = ts.createProgram(roots, {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.Preserve,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    skipLibCheck: false,
    noEmit: true,
    types: [],
  });
  return roots.flatMap((file) => {
    const source = program.getSourceFile(file);
    if (source === undefined) return [`${file}: not part of the program`];
    return [
      ...program.getSyntacticDiagnostics(source),
      ...program.getSemanticDiagnostics(source),
    ].map(
      (diagnostic) =>
        `${relative(app.dir, file)}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`,
    );
  });
}

/** Typechecks every file of the project with the `tsconfig.json` init wrote, declaration files checked. */
function typecheckProject(app: Application): { files: string[]; problems: string[] } {
  const config = ts.readConfigFile(join(app.dir, 'tsconfig.json'), ts.sys.readFile);
  if (config.error !== undefined) {
    throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, ' '));
  }
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, app.dir);
  const program = ts.createProgram(parsed.fileNames, {
    ...parsed.options,
    skipLibCheck: false,
    noEmit: true,
  });
  const problems = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)].map(
    (diagnostic) =>
      `${diagnostic.file === undefined ? '' : `${relative(app.dir, diagnostic.file.fileName)}: `}${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`,
  );
  return { files: parsed.fileNames.map((file) => relative(app.dir, file)), problems };
}

function importStatements(source: string): string[] {
  return [...source.matchAll(/^import type \{[^}]*\} from '[^']+';$/gms)].map(([statement]) =>
    statement.replace(/\s+/g, ' '),
  );
}

function importProblems(app: Application): string[] {
  return app.generatedFiles().flatMap((file) =>
    generatedImportProblems(app.read(file), {
      typesModule: TYPES_MODULE,
      migrationModule: MIGRATION_MODULE,
      extensionPackages: app.extensionPackages,
      directDependencies: app.directDependencies,
    }).map((problem) => `${file}: ${problem}`),
  );
}

describe('a facade under a name the CLI has never heard of', () => {
  let scratch: string;
  let app: Application;
  let appWithExtension: Application;

  beforeAll(() => {
    scratch = mkdtempSync(join(tmpdir(), 'orm-standin-target-'));
    const packed = packShells(scratch);
    const standin = buildStandin(scratch, packed);
    app = createInitApplication(join(scratch, 'app'), [...packed, standin]);
    appWithExtension = createApplication(
      join(scratch, 'app-with-extension'),
      [...packed, standin],
      {
        withExtension: true,
      },
    );
    for (const application of [app, appWithExtension]) {
      application.run('contract', 'emit');
      application.run('migration', 'plan', '--name', 'initial');
    }
  }, 900_000);

  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it('is installed from its own tarball and is the only facade the application declares', () => {
    expect([...app.directDependencies].sort()).toEqual(
      [
        STANDIN,
        TOOLCHAIN,
        FRAMEWORK,
        '@prisma/cli-engine',
        'typescript',
        ...Object.keys(INIT_INSTALLS),
      ].sort(),
    );
  });

  it("is what init writes the project from, through the stand-in's init entrypoint", () => {
    expect(app.read('prisma.config.ts')).toContain(
      `import { defineConfig as ormConfig } from '${STANDIN}/config';`,
    );
    expect(app.read('src/prisma/db.ts')).toContain(`from '${STANDIN}/runtime'`);
    expect(app.read('src/prisma/contract.prisma')).toContain('model User');
    expect(app.read('.env.example')).toContain('DATABASE_URL=');
  });

  it('typechecks the project init wrote, with its own tsconfig.json and db.ts', () => {
    const { files, problems } = typecheckProject(app);

    expect(files).toEqual(
      expect.arrayContaining(['prisma.config.ts', 'src/prisma/db.ts', 'src/prisma/contract.d.ts']),
    );
    expect(problems).toEqual([]);
  });

  it('emits contract types importing the framework, family, target and adapter types from its types module, in one statement', () => {
    const statements = importStatements(app.read('src/prisma/contract.d.ts'));

    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain(`from '${TYPES_MODULE}'`);
    for (const name of [
      'Contract as ContractType',
      'ContractWithTypeMaps',
      'CodecTypes as PgTypes',
      'QueryOperationTypes as PgTargetQueryOps',
    ]) {
      expect(statements[0]).toContain(name);
    }
  });

  it('plans a migration whose migration.ts imports from its migration module', () => {
    const migrations = app.generatedFiles().filter((file) => file.endsWith('migration.ts'));

    expect(migrations).toHaveLength(1);
    expect(app.read(migrations[0] ?? '')).toContain(`from '${MIGRATION_MODULE}'`);
  });

  it('runs the planned migration.ts under Node, which writes the same operations the plan did', () => {
    const [migration] = app.generatedFiles().filter((file) => file.endsWith('migration.ts'));
    const opsFile = join(dirname(migration ?? ''), 'ops.json');
    const planned = app.read(opsFile);
    rmSync(join(app.dir, opsFile));

    app.runNode(migration ?? '');

    expect(JSON.parse(app.read(opsFile))).toEqual(JSON.parse(planned));
  });

  it('writes no generated file importing anything but its config modules, an extension or a relative path', () => {
    const files = app.generatedFiles();
    expect(files.length).toBeGreaterThanOrEqual(3);
    expect(files.flatMap((file) => importedModules(app.read(file))).length).toBeGreaterThan(2);
    expect(importProblems(app)).toEqual([]);
  });

  it('typechecks the application with its generated files, declaration files checked', () => {
    expect(typecheck(app)).toEqual([]);
  });

  describe('with an extension installed beside it', () => {
    it("imports the extension's types from the extension's own package, in a statement of their own", () => {
      const statements = importStatements(appWithExtension.read('src/prisma/contract.d.ts'));

      const modules = statements.map((statement) => statement.match(/from '([^']+)'/)?.[1]);

      expect(modules).toContain(`${EXTENSION}/codec-types`);
      expect(modules.filter((module) => module === TYPES_MODULE)).toHaveLength(1);
      expect(
        modules.filter((module) => module !== TYPES_MODULE && !module?.startsWith(`${EXTENSION}/`)),
      ).toEqual([]);
      expect(statements.find((statement) => statement.includes(`'${TYPES_MODULE}'`))).not.toContain(
        'Vector',
      );
    });

    it('writes no generated file importing anything else, and typechecks', () => {
      expect(importProblems(appWithExtension)).toEqual([]);
      expect(typecheck(appWithExtension)).toEqual([]);
    });
  });
});
