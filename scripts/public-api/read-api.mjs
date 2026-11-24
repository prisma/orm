// Reads the API of one published package with API Extractor, one run per import path.
//
// Output: <package>/dist-api/<declaration file name>.api.json for each path, and
// <package>/dist-api/entry-points.json, which maps each import path to its model file.
// Anything that needs a package's API in structured form reads these files after
// `pnpm api:update` or `pnpm api:check`.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { CompilerState, Extractor, ExtractorConfig } from '@microsoft/api-extractor';

export const MODEL_FOLDER = 'dist-api';

export class ApiReadError extends Error {}

export function entryPointsOf(packageDir) {
  const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
  const entryPoints = [];
  const modelFiles = new Set();
  for (const [subpath, target] of Object.entries(manifest.exports ?? {})) {
    if (subpath === './package.json') continue;
    if (typeof target !== 'string' || !target.endsWith('.mjs')) {
      throw new ApiReadError(
        `${manifest.name}: export "${subpath}" is not a path to an .mjs file, which this script expects`,
      );
    }
    const declarationFile = join(packageDir, target.replace(/\.mjs$/, '.d.mts'));
    const modelFile = join(
      packageDir,
      MODEL_FOLDER,
      `${basename(declarationFile, '.d.mts')}.api.json`,
    );
    if (modelFiles.has(modelFile)) {
      throw new ApiReadError(`${manifest.name}: two exports point at ${target}`);
    }
    modelFiles.add(modelFile);
    entryPoints.push({ subpath, declarationFile, modelFile });
  }
  return entryPoints;
}

function extractorConfig(packageDir, { declarationFile, modelFile }) {
  return ExtractorConfig.prepare({
    configObject: {
      projectFolder: packageDir,
      mainEntryPointFilePath: declarationFile,
      bundledPackages: [],
      compiler: {
        overrideTsconfig: {
          compilerOptions: {
            target: 'es2022',
            module: 'nodenext',
            moduleResolution: 'nodenext',
            lib: ['es2023', 'dom'],
            strict: true,
            skipLibCheck: true,
            types: ['node'],
          },
          files: [declarationFile],
        },
      },
      apiReport: { enabled: false },
      docModel: {
        enabled: true,
        apiJsonFilePath: modelFile,
        includeForgottenExports: true,
        releaseTagsToTrim: [],
      },
      dtsRollup: { enabled: false },
      tsdocMetadata: { enabled: false },
      messages: {
        compilerMessageReporting: { default: { logLevel: 'error' } },
        extractorMessageReporting: { default: { logLevel: 'none' } },
        tsdocMessageReporting: { default: { logLevel: 'none' } },
      },
    },
    configObjectFullPath: join(packageDir, 'api-extractor.json'),
    packageJsonFullPath: join(packageDir, 'package.json'),
  });
}

function augmentsItself(packageDir, entryPoints) {
  const { name } = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
  const ownModule = new RegExp(
    `^declare module ["']${name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}["'/]`,
    'm',
  );
  const folders = new Set(entryPoints.map(({ declarationFile }) => dirname(declarationFile)));
  return [...folders].some((folder) =>
    readdirSync(folder)
      .filter((file) => file.endsWith('.d.mts'))
      .some((file) => ownModule.test(readFileSync(join(folder, file), 'utf8'))),
  );
}

export function readPackageApi(packageDir) {
  const entryPoints = entryPointsOf(packageDir);
  const missing = entryPoints.filter(({ declarationFile }) => !existsSync(declarationFile));
  if (missing.length > 0) {
    throw new ApiReadError(
      `${relative(process.cwd(), packageDir)}: ${missing.length} declaration file(s) missing, such as ${relative(packageDir, missing[0].declarationFile)}. Run \`pnpm build\` first.`,
    );
  }

  const modelFolder = join(packageDir, MODEL_FOLDER);
  rmSync(modelFolder, { recursive: true, force: true });
  mkdirSync(modelFolder, { recursive: true });

  const configs = entryPoints.map((entryPoint) => extractorConfig(packageDir, entryPoint));
  // One program for all paths is ten times faster. A package that augments its own module
  // gets one program per path: in a shared program the augmented members would show up
  // under the augmented path, and API Extractor fails on that.
  const compilerState = augmentsItself(packageDir, entryPoints)
    ? undefined
    : CompilerState.create(configs[0], {
        additionalEntryPoints: entryPoints.map(({ declarationFile }) => declarationFile),
      });
  const errors = [];
  for (const [index, config] of configs.entries()) {
    const { subpath } = entryPoints[index];
    const result = Extractor.invoke(config, {
      localBuild: true,
      compilerState,
      messageCallback: (message) => {
        if (message.logLevel === 'error') errors.push(`${subpath}: ${message.text}`);
        message.handled = true;
      },
    });
    if (!result.succeeded && errors.length === 0) {
      errors.push(`${subpath}: API Extractor failed with ${result.errorCount} error(s)`);
    }
  }
  if (errors.length > 0) {
    throw new ApiReadError(
      `${relative(process.cwd(), packageDir)}: API Extractor reported errors:\n  ${errors.join('\n  ')}`,
    );
  }

  writeFileSync(
    join(modelFolder, 'entry-points.json'),
    `${JSON.stringify(
      Object.fromEntries(
        entryPoints.map(({ subpath, modelFile }) => [subpath, basename(modelFile)]),
      ),
      null,
      2,
    )}\n`,
  );
  return entryPoints;
}
