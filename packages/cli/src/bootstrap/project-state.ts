import fs from 'node:fs'
import path from 'node:path'

import { findPrismaConfigFile } from '@prisma/config'

export interface ProjectState {
  hasPackageJson: boolean
  hasSchemaFile: boolean
  hasPrismaConfig: boolean
  hasEnvFile: boolean
  hasModels: boolean
  hasSeedScript: boolean
}

const SCHEMA_CANDIDATES = ['prisma/schema.prisma', 'schema.prisma']
const MODEL_PATTERN = /^\s*model\s+\w+/m

function findSchemaPath(baseDir: string): string | null {
  for (const candidate of SCHEMA_CANDIDATES) {
    const full = path.join(baseDir, candidate)
    if (fs.existsSync(full)) return full
  }
  return null
}

function checkSeedScript(baseDir: string): boolean {
  if (checkSeedInPackageJson(baseDir)) return true
  return checkSeedInPrismaConfig(baseDir)
}

function checkSeedInPackageJson(baseDir: string): boolean {
  const packageJsonPath = path.join(baseDir, 'package.json')
  if (!fs.existsSync(packageJsonPath)) return false

  try {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'))
    return typeof pkg.prisma?.seed === 'string' && pkg.prisma.seed.trim().length > 0
  } catch {
    return false
  }
}

const SEED_PATTERN = /seed\s*[:=]\s*['"`]/

function checkSeedInPrismaConfig(baseDir: string): boolean {
  const configPath = findPrismaConfigFile(baseDir)
  if (!configPath) return false

  try {
    const content = fs.readFileSync(configPath, 'utf-8')
    return SEED_PATTERN.test(content)
  } catch {
    return false
  }
}

export function getModelNames(baseDir: string): string[] {
  const schemaPath = findSchemaPath(baseDir)
  if (!schemaPath) return []
  try {
    const content = fs.readFileSync(schemaPath, 'utf-8')
    const matches = content.matchAll(/^\s*model\s+(\w+)/gm)
    return Array.from(matches, (m) => m[1])
  } catch {
    return []
  }
}

export function getSeedCommand(baseDir: string): string | null {
  const packageJsonPath = path.join(baseDir, 'package.json')
  if (fs.existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'))
      if (typeof pkg.prisma?.seed === 'string' && pkg.prisma.seed.trim().length > 0) {
        return pkg.prisma.seed.trim()
      }
    } catch {}
  }

  const configPath = findPrismaConfigFile(baseDir)
  if (configPath) {
    try {
      const content = fs.readFileSync(configPath, 'utf-8')
      const match = content.match(/seed\s*[:=]\s*['"`]([^'"`]+)['"`]/)
      if (match) return match[1]
    } catch {}
  }

  return null
}

export function detectProjectState(baseDir: string): ProjectState {
  const schemaPath = findSchemaPath(baseDir)
  const hasSchemaFile = schemaPath !== null
  let hasModels = false

  if (schemaPath) {
    try {
      const content = fs.readFileSync(schemaPath, 'utf-8')
      hasModels = MODEL_PATTERN.test(content)
    } catch {}
  }

  return {
    hasPackageJson: fs.existsSync(path.join(baseDir, 'package.json')),
    hasSchemaFile,
    hasPrismaConfig: findPrismaConfigFile(baseDir) !== null,
    hasEnvFile: fs.existsSync(path.join(baseDir, '.env')),
    hasModels,
    hasSeedScript: checkSeedScript(baseDir),
  }
}
