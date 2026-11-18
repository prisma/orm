import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createIntegrationTestDir } from '../utils/cli-test-helpers';

const __dirname = dirname(fileURLToPath(import.meta.url));
const authoringParityFixtureDir = join(__dirname, 'parity');
const authoringDiagnosticsFixtureDir = join(__dirname, 'diagnostics');
const authoringTemplateDir = join(__dirname, 'templates');

const parityRequiredFileNames = [
  'schema.prisma',
  'contract.ts',
  'packs.ts',
  'expected.contract.json',
] as const;

const diagnosticsRequiredFileNames = ['schema.prisma', 'expected-diagnostics.json'] as const;

export interface AuthoringParityFixtureCase {
  readonly caseName: string;
  readonly caseDir: string;
  readonly schemaPath: string;
  readonly contractPath: string;
  readonly packsPath: string;
  readonly expectedContractPath: string;
  /** The case's own TS config, for a case on another target; the Postgres template otherwise. */
  readonly tsConfigTemplatePath: string;
  /** The case's own PSL config, for a case on another target; the Postgres template otherwise. */
  readonly pslConfigTemplatePath: string;
}

export interface AuthoringDiagnosticsFixtureCase {
  readonly caseName: string;
  readonly caseDir: string;
  readonly schemaPath: string;
  readonly expectedDiagnosticsPath: string;
}

export function listAuthoringParityFixtureCases(): readonly AuthoringParityFixtureCase[] {
  if (!existsSync(authoringParityFixtureDir)) {
    throw new Error(`Authoring parity fixture directory not found: ${authoringParityFixtureDir}`);
  }

  const entries = readdirSync(authoringParityFixtureDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  return entries.map((caseName) => {
    const caseDir = join(authoringParityFixtureDir, caseName);
    const missingFiles = parityRequiredFileNames.filter(
      (fileName) => !existsSync(join(caseDir, fileName)),
    );

    if (missingFiles.length > 0) {
      throw new Error(
        `Authoring parity fixture case "${caseName}" is missing required files: ${missingFiles.join(', ')}`,
      );
    }

    return {
      caseName,
      caseDir,
      schemaPath: join(caseDir, 'schema.prisma'),
      contractPath: join(caseDir, 'contract.ts'),
      packsPath: join(caseDir, 'packs.ts'),
      expectedContractPath: join(caseDir, 'expected.contract.json'),
      tsConfigTemplatePath: ownOrTemplate(caseDir, 'prisma.config.parity-ts.ts'),
      pslConfigTemplatePath: ownOrTemplate(caseDir, 'prisma.config.parity-psl.ts'),
    };
  });
}

function ownOrTemplate(caseDir: string, fileName: string): string {
  const own = join(caseDir, fileName);
  return existsSync(own) ? own : join(authoringTemplateDir, fileName);
}

export function listAuthoringDiagnosticsFixtureCases(): readonly AuthoringDiagnosticsFixtureCase[] {
  if (!existsSync(authoringDiagnosticsFixtureDir)) {
    throw new Error(
      `Authoring diagnostics fixture directory not found: ${authoringDiagnosticsFixtureDir}`,
    );
  }

  const entries = readdirSync(authoringDiagnosticsFixtureDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  return entries.map((caseName) => {
    const caseDir = join(authoringDiagnosticsFixtureDir, caseName);
    const missingFiles = diagnosticsRequiredFileNames.filter(
      (fileName) => !existsSync(join(caseDir, fileName)),
    );

    if (missingFiles.length > 0) {
      throw new Error(
        `Authoring diagnostics fixture case "${caseName}" is missing required files: ${missingFiles.join(', ')}`,
      );
    }

    return {
      caseName,
      caseDir,
      schemaPath: join(caseDir, 'schema.prisma'),
      expectedDiagnosticsPath: join(caseDir, 'expected-diagnostics.json'),
    };
  });
}

export function setupIntegrationTestDirectoryForAuthoringParityCase(
  fixtureCase: AuthoringParityFixtureCase,
): {
  testDir: string;
  outputDir: string;
  cleanup: () => void;
  tsConfigPath: string;
  pslConfigPath: string;
} {
  const testDir = createIntegrationTestDir();
  const outputDir = join(testDir, 'output');
  mkdirSync(outputDir, { recursive: true });

  copyFileSync(fixtureCase.contractPath, join(testDir, 'contract.ts'));
  copyFileSync(fixtureCase.schemaPath, join(testDir, 'schema.prisma'));
  copyFileSync(fixtureCase.packsPath, join(testDir, 'packs.ts'));

  const tsConfigPath = join(testDir, 'prisma.config.parity-ts.ts');
  const pslConfigPath = join(testDir, 'prisma.config.parity-psl.ts');

  copyFileSync(fixtureCase.tsConfigTemplatePath, tsConfigPath);
  copyFileSync(fixtureCase.pslConfigTemplatePath, pslConfigPath);

  const cleanup = () => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  };

  return {
    testDir,
    outputDir,
    cleanup,
    tsConfigPath,
    pslConfigPath,
  };
}
