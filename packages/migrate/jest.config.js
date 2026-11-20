/** @type {import('jest').Config} */
module.exports = {
  preset: '../../helpers/test/presets/withSnapshotSerializer.js',
  setupFilesAfterEnv: ['<rootDir>/src/__tests__/setup.ts'],
  coveragePathIgnorePatterns: [
    'bin.ts',
    'setupMysql.ts',
    'setupPostgres.ts',
    'test-SchemaEngineCommands.ts',
    'test-handlePanic.ts',
  ],
  // to get rid of "jest-haste-map: Haste module naming collision: package name"
  modulePathIgnorePatterns: ['<rootDir>/src/__tests__/fixtures/'],
  // to allow large-ish tests in `postgresql-views`
  testTimeout: 10_000,
  prettierPath: '../../node_modules/prettier2',
}
