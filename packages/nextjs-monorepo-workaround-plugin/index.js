// @ts-check

const path = require('path');
const fs = require('fs/promises');

const prismaDirRegex = /\\?"?output\\?"?:\s*{(?:\\n?|\s)*\\?"?value\\?"?:(?:\\n?|\s)*\\?"(.*?)\\?",(?:\\n?|\s)*\\?"?fromEnvVar\\?"?/g;

/**
 * Parse the schema.prisma file to extract the output path from the generator block
 */
async function getOutputPathFromSchema(schemaPath) {
  try {
    const schemaContent = await fs.readFile(schemaPath, 'utf-8');
    const outputMatch = schemaContent.match(/generator\s+client\s*{[^}]*output\s*=\s*"([^"]+)"/);
    if (outputMatch && outputMatch[1]) {
      return outputMatch[1];
    }
  } catch (error) {
    console.warn(`[PrismaPlugin] Could not read schema at ${schemaPath}:`, error.message);
  }
  return null;
}

/**
 * Find the schema.prisma file by traversing up the directory tree
 */
async function findSchemaFile(from) {
  const possiblePaths = [
    path.join(from, 'schema.prisma'),
    path.join(from, '../schema.prisma'),
    path.join(from, '../../schema.prisma'),
    path.join(from, '../../../schema.prisma'),
    path.join(from, '../../../../schema.prisma'),
    path.join(from, '../../prisma/schema.prisma'),
    path.join(from, '../../../prisma/schema.prisma'),
    path.join(from, '../../../../prisma/schema.prisma'),
    path.join(from, '../../../prisma/schema/schema.prisma'),
    path.join(from, '../../../../prisma/schema/schema.prisma'),
    path.join(from, '../../../../../prisma/schema/schema.prisma'),
  ];

  for (const possiblePath of possiblePaths) {
    if (await fs.stat(possiblePath).catch(() => false)) {
      return possiblePath;
    }
  }

  return null;
}

/**
 * Resolves the Prisma directory for custom output paths in a monorepo
 * @param {string} from - The output path from the bundled code
 */
async function getPrismaDir(from) {
  if (await fs.stat(path.join(from, 'schema.prisma')).catch(() => false)) {
    return from;
  }

  const schemaFile = await findSchemaFile(from);
  if (schemaFile) {
    return path.dirname(schemaFile);
  }

  console.warn(`[PrismaPlugin] Could not find schema.prisma from: ${from}`);
  return from;
}

/**
 * Get all Prisma files (schema + engine binaries) from the generated client directory
 * @param {string} from - The output path from the bundled code
 */
async function getPrismaFiles(from) {
  try {
    console.log(`[PrismaPlugin] >>> Getting Prisma files from: ${from}`);

    // If 'from' already points to a generated client directory, use it directly
    // This happens when webpack bundles code that imports from the generated client
    if (from.includes('/generated/') && from.includes('-client')) {
      console.log(`[PrismaPlugin] ✓ Using existing generated client path: ${from}`);

      // Check if directory exists
      const dirExists = await fs.stat(from).catch(() => false);
      if (!dirExists) {
        console.error(`[PrismaPlugin] ✗ Client directory does not exist: ${from}`);
        return { files: [], clientDir: from, schemaDir: from };
      }

      // Look for schema.prisma and all engine binaries (.node files)
      const filterRegex = /schema\.prisma$|libquery_engine.*\.node$|query_engine.*\.node$/;
      const allFiles = await fs.readdir(from);
      const prismaFiles = allFiles.filter((file) => file.match(filterRegex));

      console.log(`[PrismaPlugin] ✓ Found ${prismaFiles.length} Prisma files:`, prismaFiles);

      return {
        files: prismaFiles,
        clientDir: from,
        schemaDir: path.dirname(from), // We don't have the schema dir, but this is close enough
      };
    }

    // Otherwise, find the schema and resolve the client path
    const schemaFile = await findSchemaFile(from);
    if (!schemaFile) {
      console.warn(`[PrismaPlugin] ✗ No schema file found for: ${from}`);
      return { files: [], clientDir: from, schemaDir: from };
    }
    console.log(`[PrismaPlugin] ✓ Found schema file: ${schemaFile}`);

    const outputPath = await getOutputPathFromSchema(schemaFile);
    if (!outputPath) {
      console.warn(`[PrismaPlugin] ✗ No output path found in schema: ${schemaFile}`);
      return { files: [], clientDir: from, schemaDir: from };
    }
    console.log(`[PrismaPlugin] ✓ Output path from schema: ${outputPath}`);

    const schemaDir = path.dirname(schemaFile);
    const generatedClientDir = path.resolve(schemaDir, outputPath);

    console.log(`[PrismaPlugin] ✓ Resolved client directory: ${generatedClientDir}`);

    // Check if directory exists
    const dirExists = await fs.stat(generatedClientDir).catch(() => false);
    if (!dirExists) {
      console.error(`[PrismaPlugin] ✗ Client directory does not exist: ${generatedClientDir}`);
      return { files: [], clientDir: generatedClientDir, schemaDir: path.dirname(schemaFile) };
    }

    // Look for schema.prisma and all engine binaries (.node files)
    const filterRegex = /schema\.prisma$|libquery_engine.*\.node$|query_engine.*\.node$/;
    const allFiles = await fs.readdir(generatedClientDir);
    const prismaFiles = allFiles.filter((file) => file.match(filterRegex));

    console.log(`[PrismaPlugin] ✓ Found ${prismaFiles.length} Prisma files:`, prismaFiles);

    return {
      files: prismaFiles,
      clientDir: generatedClientDir,
      schemaDir: path.dirname(schemaFile),
    };
  } catch (error) {
    console.error(`[PrismaPlugin] ✗ Error getting Prisma files from: ${from}`);
    console.error(`[PrismaPlugin] Error details:`, error.message);
    console.error(`[PrismaPlugin] Stack:`, error.stack);
    return { files: [], clientDir: from, schemaDir: from };
  }
}

class PrismaPlugin {
  constructor(options = {}) {
    this.options = options;
  }

  apply(compiler) {
    const { webpack } = compiler;
    const { Compilation, sources } = webpack;

    const originAssetsToCopies = {};
    const origins = [];

    compiler.hooks.compilation.tap('PrismaPlugin', (compilation) => {
      compilation.hooks.processAssets.tapPromise(
        {
          name: 'PrismaPlugin',
          stage: Compilation.PROCESS_ASSETS_STAGE_ANALYSE,
        },
        async (assets) => {
          const jsAssetNames = Object.keys(assets).filter((k) => k.endsWith('.js'));
          const jsAsyncActions = jsAssetNames.map(async (assetName) => {
            const outputDir = compiler.outputPath;
            const assetPath = path.resolve(outputDir, assetName);
            const assetDir = path.dirname(assetPath);

            const oldSourceAsset = compilation.getAsset(assetName);
            const oldSourceContents = oldSourceAsset.source.source() + '';

            for (const match of oldSourceContents.matchAll(prismaDirRegex)) {
              try {
                const result = await getPrismaFiles(match[1]);
                const { files: prismaFiles, clientDir, schemaDir } = result;

                if (prismaFiles.length === 0) {
                  continue;
                }

                const schemaFile = await findSchemaFile(match[1]);
                const schemaFilename = schemaFile ? path.basename(schemaFile) : 'schema.prisma';

                console.log(`[PrismaPlugin] Processing ${prismaFiles.length} files from ${clientDir}`);

                prismaFiles.forEach((f) => {
                  const from = path.join(clientDir, f);
                  const originIndexLookup = origins.indexOf(clientDir);
                  const originIndex = originIndexLookup !== -1 ? originIndexLookup : origins.push(clientDir) - 1;
                  const assetCopies = (originAssetsToCopies[from] = originAssetsToCopies[from] || []);

                  // Copy schema.prisma with suffix, but engine binaries without suffix
                  const copyFilename = f === schemaFilename ? `${f}${originIndex}` : f;
                  const copyPath = path.join(assetDir, copyFilename);

                  if (!assetCopies.includes(copyPath)) {
                    assetCopies.push(copyPath);
                    console.log(`[PrismaPlugin] Will copy ${f} to ${copyPath}`);
                  }

                  // For engine binaries, also copy to the central chunks directory
                  // This is where Prisma looks first according to the error logs
                  if (f.match(/\.node$/)) {
                    const outputDir = compiler.outputPath;
                    const chunksDir = path.join(outputDir, 'chunks');
                    const chunksPath = path.join(chunksDir, f);
                    if (!assetCopies.includes(chunksPath)) {
                      assetCopies.push(chunksPath);
                      console.log(`[PrismaPlugin] Will also copy ${f} to chunks directory: ${chunksPath}`);
                    }
                  }

                  if (f === schemaFilename) {
                    const newSourceString = oldSourceContents.replace(new RegExp(schemaFilename, 'g'), copyFilename);
                    const newRawSource = new sources.RawSource(newSourceString);
                    compilation.updateAsset(assetName, newRawSource);
                  }
                });
              } catch (error) {
                console.warn(`[PrismaPlugin] Error processing asset ${assetName}:`, error.message);
              }
            }
          });

          await Promise.all(jsAsyncActions);
        },
      );
    });

    compiler.hooks.compilation.tap('PrismaPlugin', (compilation) => {
      compilation.hooks.processAssets.tapPromise(
        {
          name: 'PrismaPlugin',
          stage: Compilation.PROCESS_ASSETS_STAGE_ANALYSE,
        },
        (assets) => {
          const nftAssetNames = Object.keys(assets).filter((k) => k.endsWith('.nft.json'));
          nftAssetNames.forEach((assetName) => {
            const outputDir = compiler.outputPath;
            const assetPath = path.resolve(outputDir, assetName);
            const assetDir = path.dirname(assetPath);

            const oldSourceAsset = compilation.getAsset(assetName);
            const oldSourceContents = oldSourceAsset.source.source() + '';
            const ntfLoadedAsJson = JSON.parse(oldSourceContents);

            Object.values(originAssetsToCopies).forEach((copies) => {
              const copiesPaths = copies.map((copy) => path.relative(assetDir, copy));
              ntfLoadedAsJson.files.push(...copiesPaths);
            });

            const newSourceString = JSON.stringify(ntfLoadedAsJson);
            const newRawSource = new sources.RawSource(newSourceString);
            compilation.updateAsset(assetName, newRawSource);
          });

          return Promise.resolve();
        },
      );
    });

    compiler.hooks.done.tapPromise('PrismaPlugin', async () => {
      console.log(`[PrismaPlugin] Copying ${Object.keys(originAssetsToCopies).length} Prisma files...`);

      const asyncActions = Object.entries(originAssetsToCopies).map(async ([from, copies]) => {
        await Promise.all(
          copies.map(async (copy) => {
            if ((await fs.access(copy).catch(() => false)) === false) {
              await fs.mkdir(path.dirname(copy), { recursive: true }).catch(() => {});
              return fs
                .copyFile(from, copy)
                .then(() => {
                  console.log(`[PrismaPlugin] ✓ Copied ${path.basename(from)} to ${copy}`);
                })
                .catch((error) => {
                  console.error(`[PrismaPlugin] ✗ Failed to copy ${from} to ${copy}:`, error.message);
                });
            }
            console.log(`[PrismaPlugin] ⊙ Skipped ${path.basename(from)} (already exists)`);
          }),
        );
      });

      await Promise.all(asyncActions);
      console.log('[PrismaPlugin] Done copying Prisma files');
    });
  }
}

module.exports = { PrismaPlugin };
