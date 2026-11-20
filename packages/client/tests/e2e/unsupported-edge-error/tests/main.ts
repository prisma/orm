const navigator = { ...globalThis.navigator }

afterEach(() => {
  globalThis.navigator = navigator
})

test('proper error is shown when importing the browser build from cloudflare workers', async () => {
  const response = await fetch('http://localhost:8787')
  expect(response.status).toBe(200)
  const text = await response.text()

  expect(text).toMatchInlineSnapshot(`
"In order to run Prisma Client on edge runtime, either:
- Use Prisma Accelerate: https://pris.ly/d/accelerate
- Use Driver Adapters: https://pris.ly/d/driver-adapters"
`)
})

export {}
