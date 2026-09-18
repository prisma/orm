/**
 * Post-processes migration SQL to support generated columns.
 *
 * This function transforms columns marked with @default(dbgenerated()) and a special
 * comment marker into database-native GENERATED ALWAYS AS columns.
 *
 * Example schema:
 * ```prisma
 * model User {
 *   firstName String
 *   lastName  String
 *   /// @generatedColumn firstName || ' ' || lastName
 *   fullName  String @default(dbgenerated())
 * }
 * ```
 *
 * This will transform the migration SQL from:
 * ```sql
 * ALTER TABLE "User" ADD COLUMN "fullName" TEXT DEFAULT '';
 * ```
 *
 * To:
 * ```sql
 * ALTER TABLE "User" ADD COLUMN "fullName" TEXT GENERATED ALWAYS AS (firstName || ' ' || lastName) STORED;
 * ```
 */

export interface GeneratedColumnInfo {
  tableName: string
  columnName: string
  expression: string
  columnType: string
}

/**
 * Extracts generated column information from Prisma schema
 */
export function extractGeneratedColumns(schemaContent: string): GeneratedColumnInfo[] {
  const generatedColumns: GeneratedColumnInfo[] = []

  // Match model blocks
  const modelRegex = /model\s+(\w+)\s*{([^}]+)}/g
  let modelMatch

  while ((modelMatch = modelRegex.exec(schemaContent)) !== null) {
    const modelName = modelMatch[1]
    const modelBody = modelMatch[2]

    // Split into lines and process
    const lines = modelBody.split('\n')

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim()

      // Check for @generatedColumn comment
      const commentMatch = line.match(/\/\/\/\s*@generatedColumn\s+(.+)/)
      if (commentMatch && i + 1 < lines.length) {
        const expression = commentMatch[1].trim()
        const nextLine = lines[i + 1].trim()

        // Check if next line has @default(dbgenerated())
        const fieldMatch = nextLine.match(/(\w+)\s+(\w+).*@default\(dbgenerated\(\)\)/)
        if (fieldMatch) {
          generatedColumns.push({
            tableName: modelName,
            columnName: fieldMatch[1],
            expression: expression,
            columnType: fieldMatch[2],
          })
        }
      }
    }
  }

  return generatedColumns
}

/**
 * Transforms migration SQL to use GENERATED ALWAYS AS for marked columns
 */
export function transformMigrationSQL(
  sql: string,
  generatedColumns: GeneratedColumnInfo[],
  connectorType: string,
): string {
  let transformedSQL = sql

  for (const col of generatedColumns) {
    transformedSQL = transformColumnToGenerated(transformedSQL, col, connectorType)
  }

  return transformedSQL
}

/**
 * Transforms a single column definition to use GENERATED ALWAYS AS
 */
function transformColumnToGenerated(sql: string, col: GeneratedColumnInfo, connectorType: string): string {
  const { tableName, columnName, expression } = col

  // Different databases have different syntax
  switch (connectorType.toLowerCase()) {
    case 'postgresql':
    case 'cockroachdb':
      return transformPostgreSQLColumn(sql, tableName, columnName, expression)

    case 'mysql':
      return transformMySQLColumn(sql, tableName, columnName, expression)

    case 'sqlite':
      return transformSQLiteColumn(sql, tableName, columnName, expression)

    default:
      console.warn(`Generated columns not yet supported for ${connectorType}`)
      return sql
  }
}

/**
 * Transform PostgreSQL column to GENERATED ALWAYS AS
 */
function transformPostgreSQLColumn(sql: string, tableName: string, columnName: string, expression: string): string {
  // Match ADD COLUMN statements
  // Capture type including optional parentheses: VARCHAR(255)
  const addColumnRegex = new RegExp(
    `ALTER TABLE\\s+"${tableName}"\\s+ADD COLUMN\\s+"${columnName}"\\s+(\\w+(?:\\([^)]+\\))?)\\s+(?:DEFAULT\\s+[^,;]+)?`,
    'gi',
  )

  return sql.replace(addColumnRegex, (match, dataType) => {
    return `ALTER TABLE "${tableName}" ADD COLUMN "${columnName}" ${dataType} GENERATED ALWAYS AS (${expression}) STORED`
  })
}

/**
 * Transform MySQL column to GENERATED ALWAYS AS
 */
function transformMySQLColumn(sql: string, tableName: string, columnName: string, expression: string): string {
  // MySQL uses backticks
  // Capture type including optional parentheses: VARCHAR(255)
  const addColumnRegex = new RegExp(
    `ALTER TABLE\\s+\`${tableName}\`\\s+ADD COLUMN\\s+\`${columnName}\`\\s+(\\w+(?:\\([^)]+\\))?)\\s+(?:DEFAULT\\s+[^,;]+)?`,
    'gi',
  )

  // MySQL uses CONCAT instead of ||
  const mysqlExpression = expression.replace(/\|\|/g, ',').replace(/'/g, '"')
  const wrappedExpression = mysqlExpression.includes('CONCAT') ? mysqlExpression : `CONCAT(${mysqlExpression})`

  return sql.replace(addColumnRegex, (match, dataType) => {
    return `ALTER TABLE \`${tableName}\` ADD COLUMN \`${columnName}\` ${dataType} GENERATED ALWAYS AS (${wrappedExpression}) STORED`
  })
}

/**
 * Transform SQLite column to GENERATED ALWAYS AS
 */
function transformSQLiteColumn(sql: string, tableName: string, columnName: string, expression: string): string {
  // SQLite uses double quotes
  // Capture type including optional parentheses: VARCHAR(255)
  const addColumnRegex = new RegExp(
    `ALTER TABLE\\s+"${tableName}"\\s+ADD COLUMN\\s+"${columnName}"\\s+(\\w+(?:\\([^)]+\\))?)\\s+(?:DEFAULT\\s+[^,;]+)?`,
    'gi',
  )

  return sql.replace(addColumnRegex, (match, dataType) => {
    return `ALTER TABLE "${tableName}" ADD COLUMN "${columnName}" ${dataType} GENERATED ALWAYS AS (${expression}) STORED`
  })
}
