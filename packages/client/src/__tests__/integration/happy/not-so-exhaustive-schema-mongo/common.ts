import fs from 'fs'
import path from 'path'

import { generateTestClient } from '../../../../utils/getTestClient'

const isMacOrWindowsCI = Boolean(process.env.CI) && ['darwin', 'win32'].includes(process.platform)
if (isMacOrWindowsCI) {
  jest.setTimeout(80_000)
}

export const testGeneratedClient = () => async () => {
  const clientDir = path.join(__dirname, 'test-clients', 'client')
  await fs.promises.mkdir(clientDir, { recursive: true })
  await fs.promises.copyFile(path.join(__dirname, 'schema.prisma'), path.join(clientDir, 'schema.prisma'))

  await generateTestClient({
    projectDir: clientDir,
  })

  const generatedTypeScript = fs.readFileSync(path.join(clientDir, './node_modules/.prisma/client/index.d.ts'), 'utf-8')
  const generatedBrowserJS = fs.readFileSync(
    path.join(clientDir, './node_modules/.prisma/client/index-browser.js'),
    'utf-8',
  )

  expect(generatedTypeScript).toMatchSnapshot('generatedTypeScript')
  expect(generatedBrowserJS).toMatchSnapshot('generatedBrowserJS')
}
