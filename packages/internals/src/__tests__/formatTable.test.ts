import { describe, expect, it } from 'vitest'

import { formatTable } from '../utils/formatTable'

describe('formatTable', () => {
  const rows = [
    ['prisma', '0.0.0'],
    ['@prisma/client', 'Not found'],
    ['Current platform', 'debian-openssl-1.1.x'],
    [
      'Query Engine (Node-API)',
      'libquery-engine 2b0c12756921c891fec4f68d9444e18c7d5d4a6a (at ../../../.npm/_npx/2778af9cee32ff87/node_modules/@prisma/engines/libquery_engine-debian-openssl-1.1.x.so.node)',
    ],
  ]

  it('creates regular spacing in table', () => {
    const result = formatTable(rows)
    expect(result).toMatchInlineSnapshot(`
      "prisma                  : 0.0.0
      @prisma/client          : Not found
      Current platform        : debian-openssl-1.1.x
      Query Engine (Node-API) : libquery-engine 2b0c12756921c891fec4f68d9444e18c7d5d4a6a (at ../../../.npm/_npx/2778af9cee32ff87/node_modules/@prisma/engines/libquery_engine-debian-openssl-1.1.x.so.node)"
    `)
  })

  it('creates regular spacing in table with JSON option', () => {
    const result = formatTable(rows, { json: true })
    expect(result).toMatchInlineSnapshot(`
      "{
        "prisma": "0.0.0",
        "@prisma/client": "Not found",
        "current-platform": "debian-openssl-1.1.x",
        "query-engine-(node-api)": "libquery-engine 2b0c12756921c891fec4f68d9444e18c7d5d4a6a (at ../../../.npm/_npx/2778af9cee32ff87/node_modules/@prisma/engines/libquery_engine-debian-openssl-1.1.x.so.node)"
      }"
    `)
  })
})
