import fs from 'node:fs'

import { TsConfigJson, TsConfigJsonResolved } from 'get-tsconfig'
import { packageUpSync } from 'package-up'

import { GeneratedFileExtension } from './file-extensions'

const moduleFormats = ['esm', 'cjs'] as const

export type ModuleFormat = (typeof moduleFormats)[number]

export function parseModuleFormat(format: string): ModuleFormat {
  switch (format.toLowerCase()) {
    case 'cjs':
    case 'commonjs':
      return 'cjs'
    case 'esm':
      return 'esm'
    default:
      throw new Error(`Invalid module format: "${format}", expected "esm" or "cjs"`)
  }
}

export function parseModuleFormatFromUnknown(value: unknown): ModuleFormat {
  if (typeof value === 'string') {
    return parseModuleFormat(value)
  } else {
    throw new Error(`Invalid module format: ${JSON.stringify(value)}, expected "esm" or "cjs"`)
  }
}

type InferModuleFormatOptions = {
  tsconfig: TsConfigJsonResolved | undefined
  generatedFileExtension: GeneratedFileExtension
  importFileExtension: GeneratedFileExtension
  outputDir: string
}

export function inferModuleFormat({
  tsconfig,
  generatedFileExtension,
  importFileExtension,
  outputDir,
}: InferModuleFormatOptions): ModuleFormat {
  if (tsconfig?.compilerOptions?.module) {
    return fromTsConfigModule(tsconfig.compilerOptions.module, outputDir)
  }

  if (generatedFileExtension === 'cts' || importFileExtension === 'cjs') {
    return 'cjs'
  }

  return 'esm'
}

// With these `module` settings, TypeScript does not treat the project as ESM or CommonJS
// uniformly. Instead, it determines the format on a per-file basis by looking at the nearest
// `package.json`'s `type` field, defaulting to CommonJS when it is absent or not `"module"`.
const nodeNextModuleModes = new Set<TsConfigJson.CompilerOptions.Module>(['node16', 'nodenext'])

function fromTsConfigModule(module: TsConfigJson.CompilerOptions.Module, outputDir: string): ModuleFormat {
  const normalizedModule = module.toLowerCase() as TsConfigJson.CompilerOptions.Module

  if (normalizedModule === 'commonjs') {
    return 'cjs'
  }

  if (nodeNextModuleModes.has(normalizedModule)) {
    return inferModuleFormatFromNearestPackageJson(outputDir)
  }

  return 'esm'
}

function inferModuleFormatFromNearestPackageJson(outputDir: string): ModuleFormat {
  const packageJsonPath = packageUpSync({ cwd: outputDir })

  if (!packageJsonPath) {
    return 'cjs'
  }

  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'))
    return packageJson.type === 'module' ? 'esm' : 'cjs'
  } catch {
    return 'cjs'
  }
}
