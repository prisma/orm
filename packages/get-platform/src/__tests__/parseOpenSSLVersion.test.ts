import { describe, expect, test } from 'vitest'

import { parseLibSSLVersion, parseOpenSSLVersion } from '../getPlatform'

describe('parseOpenSSLVersion', () => {
  const tests = [
    {
      name: 'openssl 1.1',
      content: `OpenSSL 1.1.0d  1 Feb 2014`,
      expect: '1.1.x',
    },
    {
      name: 'openssl 1.0.2',
      content: `OpenSSL 1.0.2g  1 Mar 2016`,
      expect: '1.0.x',
    },
    {
      name: 'openssl 3.0',
      content: `OpenSSL 3.0.2 15 Mar 2022 (Library: OpenSSL 3.0.2 15 Mar 2022)`,
      expect: '3.0.x',
    },
    {
      name: 'openssl 3.1',
      content: `OpenSSL 3.1.0 sometimes in 2023`,
      expect: '3.0.x',
    },
    {
      name: 'openssl 0.9.8 is unsupported',
      content: `OpenSSL 0.9.8`,
      expect: undefined,
    },
    {
      name: 'openssl 2.0.1 is unsupported',
      content: `OpenSSL 2.0.1`,
      expect: undefined,
    },
    {
      name: 'openssl 4.0 is unsupported',
      content: `OpenSSL 4.0.1`,
      expect: undefined,
    },
  ]

  test.each(tests)('$name', (t) => {
    const actual = parseOpenSSLVersion(t.content)
    expect(actual).toBe(t.expect)
  })
})

describe('parseLibSSLVersion', () => {
  const tests = [
    {
      name: 'libssl 1.0',
      content: `/lib/libssl.so.1`,
      expect: '1.0.x',
    },
    {
      name: 'libssl 1.0.2k',
      content: `/lib/libssl.so.1.0.2k`,
      expect: '1.0.x',
    },
    {
      name: 'libssl 10',
      content: `/lib/libssl.so.10`,
      expect: '1.0.x',
    },
    {
      name: 'libssl 1.1',
      content: `/lib/libssl.so.1.1`,
      expect: '1.1.x',
    },
    {
      name: 'libssl 1.1.1',
      content: `/lib/libssl.so.1.1.1`,
      expect: '1.1.x',
    },
    {
      name: 'libssl 1.1.1g',
      content: `/lib64/libssl.so.1.1.1g`,
      expect: '1.1.x',
    },
    {
      name: 'libssl 3.0',
      content: `/lib/libssl.so.3`,
      expect: '3.0.x',
    },
    {
      name: 'libssl 3.1',
      content: `/lib/libssl.so.3.1`,
      expect: '3.0.x',
    },
    {
      name: 'libssl.so.0.9.8 is unsupported',
      content: `/lib/libssl.so.0.9.8`,
      expect: undefined,
    },
    {
      name: 'libssl.so.2 is unsupported',
      content: `/lib/libssl.so.2`,
      expect: undefined,
    },
    {
      name: 'libssl.so.4 is unsupported',
      content: `/lib/libssl.so.4`,
      expect: undefined,
    },
    {
      name: 'The "nss" library must not be mistakenly parsed as "libssl"',
      content: `/lib/libssl3.so`,
      expect: undefined,
    },
  ]

  test.each(tests)('$name', (t) => {
    const actual = parseLibSSLVersion(t.content)
    expect(actual).toBe(t.expect)
  })
})
