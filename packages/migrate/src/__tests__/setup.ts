const originalEnv = { ...process.env }
const originalCwd = process.cwd()

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) {
      delete process.env[key]
    }
  }

  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

beforeEach(() => {
  process.chdir(originalCwd)
  restoreEnv()
  // To avoid the loading spinner prints in local cli output snapshot tests
  process.env.CI = 'true'
})

afterEach(() => {
  process.chdir(originalCwd)
  restoreEnv()
})
