import fs from 'node:fs'
import path from 'node:path'

import { getTsconfig } from 'get-tsconfig'

/**
 * Determines the client output path relative to the schema directory.
 *
 * @param schemaDir absolute path to the schema directory
 * @returns client output path relative to the schema directory
 */
export function determineClientOutputPath(schemaDir: string): string {
  const sourceDir = getSourceDir()
  const outputPath = path.join(sourceDir, 'generated', 'prisma')
  const relativeOutputPath = path.relative(schemaDir, outputPath)

  // Normalize path separators to forward slashes
  return relativeOutputPath.replaceAll(path.sep, '/')
}

/**
 * Determines the absolute path to the source directory.
 */
function getSourceDir(): string {
  const projectDir = process.cwd()

  const sourceRootFromTsConfig = getSourceDirFromTypeScriptConfig()

  if (sourceRootFromTsConfig) {
    return path.join(projectDir, sourceRootFromTsConfig)
  }

  // Check common source directories if there's no tsconfig.json
  for (const dir of ['src', 'lib', 'app']) {
    const absoluteSourceDir = path.join(projectDir, dir)
    if (fs.existsSync(absoluteSourceDir)) {
      return absoluteSourceDir
    }
  }

  // Default fallback if we can't determine anything better
  return projectDir
}

function getSourceDirFromTypeScriptConfig(): string | undefined {
  const tsconfig = getTsconfig()

  if (!tsconfig) {
    return undefined
  }

  const { config } = tsconfig

  return config.compilerOptions?.rootDir ?? config.compilerOptions?.baseUrl ?? config.compilerOptions?.rootDirs?.[0]
}
