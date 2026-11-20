import { dim } from 'kleur/colors'

import type { DatasourceInfo } from '../utils/ensureDatabaseExists'

// Datasource "db": SQLite database "dev.db" at "file:./dev.db"
// Datasource "my_db": PostgreSQL database "tests-migrate", schema "public" at "localhost:5432"
// Datasource "my_db": MySQL database "tests-migrate" at "localhost:5432"
// Datasource "my_db": MongoDB database "tests-migrate" at "localhost:27017"
// Datasource "my_db": SQL Server database
export function printDatasource({ datasourceInfo }: { datasourceInfo: DatasourceInfo }): void {
  if (!datasourceInfo.name || !datasourceInfo.prettyProvider) return

  let message = `Datasource "${datasourceInfo.name}": ${datasourceInfo.prettyProvider} database`
  if (datasourceInfo.dbName) {
    message += ` "${datasourceInfo.dbName}"`
  }

  // If schemas are defined in the datasource block, print them
  if (datasourceInfo.schemas?.length) {
    message += `, schemas "${datasourceInfo.schemas.join(', ')}"`
  }
  // Otherwise, print the schema if it's defined in the connection string
  else if (datasourceInfo.schema) {
    message += `, schema "${datasourceInfo.schema}"`
  }

  if (datasourceInfo.dbLocation) {
    message += ` at "${datasourceInfo.dbLocation}"`
  }

  process.stdout.write(dim(message) + '\n')
}
