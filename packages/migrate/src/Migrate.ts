import { SchemaEngineConfigInternal } from '@prisma/config'
import { MigrateTypes, SchemaContext, toSchemasContainer } from '@prisma/internals'

import { Extension } from './extensions'
import type { SchemaEngine } from './SchemaEngine'
import { SchemaEngineCLI } from './SchemaEngineCLI'
import type { EngineArgs, EngineResults } from './types'
import { createMigration, writeMigrationLockfile, writeMigrationScript } from './utils/createMigration'
import { listMigrations } from './utils/listMigrations'

type MigrateSetupInput = {
  schemaEngineConfig: SchemaEngineConfigInternal
  migrationsDirPath?: string
  enabledPreviewFeatures?: string[]
  schemaContext?: SchemaContext
  schemaFilter?: MigrateTypes.SchemaFilter
  shadowDbInitScript?: string
  extensions?: Extension[]
  baseDir: string
}

interface MigrateOptions {
  engine: SchemaEngine
  schemaContext?: SchemaContext
  migrationsDirPath?: string
  schemaFilter?: MigrateTypes.SchemaFilter
  shadowDbInitScript?: string
}

export class Migrate {
  public readonly engine: SchemaEngine
  private schemaContext?: SchemaContext
  private schemaFilter: MigrateTypes.SchemaFilter
  private shadowDbInitScript: string
  public migrationsDirectoryPath?: string

  private constructor({ schemaContext, migrationsDirPath, engine, schemaFilter, shadowDbInitScript }: MigrateOptions) {
    this.engine = engine

    // schemaPath and migrationsDirectoryPath are optional for primitives
    // like migrate diff and db execute
    this.schemaContext = schemaContext
    this.migrationsDirectoryPath = migrationsDirPath
    this.schemaFilter = schemaFilter ?? { externalTables: [], externalEnums: [] }
    this.shadowDbInitScript = shadowDbInitScript ?? ''
  }

  static async setup({ schemaContext, schemaEngineConfig, ...rest }: MigrateSetupInput): Promise<Migrate> {
    const schemaEngine = await (async () => {
      const datasource = schemaEngineConfig.datasource
      return await SchemaEngineCLI.setup({ datasource, schemaContext, ...rest })
    })()

    return new Migrate({ engine: schemaEngine, schemaContext, ...rest })
  }

  public async stop(): Promise<void> {
    await this.engine.stop()
  }

  public getPrismaSchema(): MigrateTypes.SchemasContainer {
    if (!this.schemaContext) throw new Error('this.schemaContext is undefined')

    return toSchemasContainer(this.schemaContext.schemaFiles)
  }

  public reset(): Promise<void> {
    return this.engine.reset({
      filter: this.schemaFilter,
    })
  }

  public async createMigration(
    params: Omit<EngineArgs.CreateMigrationInput, 'migrationsList' | 'filters'>,
  ): Promise<{ generatedMigrationName: string | undefined }> {
    if (!this.migrationsDirectoryPath) throw new Error('this.migrationsDirectoryPath is undefined')

    const migrationsList = await listMigrations(this.migrationsDirectoryPath, this.shadowDbInitScript)
    const { connectorType, generatedMigrationName, extension, migrationScript } = await this.engine.createMigration({
      ...params,
      migrationsList,
      filters: this.schemaFilter,
    })
    const { baseDir, lockfile } = migrationsList

    if (migrationScript === null) {
      return {
        generatedMigrationName: undefined,
      }
    }

    const directoryPath = await createMigration({
      baseDir,
      generatedMigrationName,
    }).catch((e: Error) => {
      throw new Error(`Failed to create a new migration directory: ${e.message}`)
    })

    await writeMigrationScript({
      baseDir,
      extension,
      migrationName: generatedMigrationName,
      script: migrationScript,
    }).catch((e: Error) => {
      throw new Error(`Failed to write migration script to ${directoryPath}: ${e.message}`)
    })

    await writeMigrationLockfile({
      baseDir,
      connectorType,
      lockfile,
    }).catch((e: Error) => {
      throw new Error(`Failed to write the migration lock file to ${baseDir}: ${e.message}`)
    })

    return {
      generatedMigrationName,
    }
  }

  public async diagnoseMigrationHistory({
    optInToShadowDatabase,
  }: {
    optInToShadowDatabase: boolean
  }): Promise<EngineResults.DiagnoseMigrationHistoryOutput> {
    if (!this.migrationsDirectoryPath) throw new Error('this.migrationsDirectoryPath is undefined')

    const migrationsList = await listMigrations(this.migrationsDirectoryPath, this.shadowDbInitScript)

    return this.engine.diagnoseMigrationHistory({
      migrationsList,
      optInToShadowDatabase,
      filters: this.schemaFilter,
    })
  }

  public async listMigrationDirectories(): Promise<EngineResults.ListMigrationDirectoriesOutput> {
    if (!this.migrationsDirectoryPath) throw new Error('this.migrationsDirectoryPath is undefined')

    const migrationsList = await listMigrations(this.migrationsDirectoryPath, this.shadowDbInitScript)

    return {
      migrations: migrationsList.migrationDirectories.map((dir) => dir.path),
    }
  }

  public async devDiagnostic(): Promise<EngineResults.DevDiagnosticOutput> {
    if (!this.migrationsDirectoryPath) throw new Error('this.migrationsDirectoryPath is undefined')

    const migrationsList = await listMigrations(this.migrationsDirectoryPath, this.shadowDbInitScript)

    return this.engine.devDiagnostic({
      migrationsList,
      filters: this.schemaFilter,
    })
  }

  public async markMigrationApplied({ migrationId }: { migrationId: string }): Promise<void> {
    if (!this.migrationsDirectoryPath) throw new Error('this.migrationsDirectoryPath is undefined')

    const migrationsList = await listMigrations(this.migrationsDirectoryPath, this.shadowDbInitScript)

    return await this.engine.markMigrationApplied({
      migrationsList,
      migrationName: migrationId,
    })
  }

  public markMigrationRolledBack({ migrationId }: { migrationId: string }): Promise<void> {
    return this.engine.markMigrationRolledBack({
      migrationName: migrationId,
    })
  }

  public async applyMigrations(): Promise<EngineResults.ApplyMigrationsOutput> {
    if (!this.migrationsDirectoryPath) throw new Error('this.migrationsDirectoryPath is undefined')

    const migrationsList = await listMigrations(this.migrationsDirectoryPath, this.shadowDbInitScript)

    return this.engine.applyMigrations({
      migrationsList,
      filters: this.schemaFilter,
    })
  }

  public async evaluateDataLoss(): Promise<EngineResults.EvaluateDataLossOutput> {
    if (!this.migrationsDirectoryPath) throw new Error('this.migrationsDirectoryPath is undefined')

    const migrationsList = await listMigrations(this.migrationsDirectoryPath, this.shadowDbInitScript)
    const schema = this.getPrismaSchema()

    return this.engine.evaluateDataLoss({
      migrationsList,
      schema: schema,
      filters: this.schemaFilter,
    })
  }

  public async push({ force = false }: { force?: boolean }): Promise<EngineResults.SchemaPush> {
    const schema = this.getPrismaSchema()

    const { warnings, unexecutable, executedSteps } = await this.engine.schemaPush({
      force,
      schema,
      filters: this.schemaFilter,
    })

    return {
      executedSteps,
      warnings,
      unexecutable,
    }
  }
}
