import { describe, expect, test } from 'vitest'

import { longestCommonPathPrefix, pathToPosix } from './path'

const testIf = (condition: boolean) => (condition ? test : test.skip)
const describeIf = (condition: boolean) => (condition ? describe : describe.skip)

describe('pathToPosix', () => {
  test('forward slashes', () => {
    expect(pathToPosix('a/b/c')).toBe('a/b/c')
  })

  testIf(process.platform === 'win32')('backslashes on windows', () => {
    expect(pathToPosix('a\\b\\c')).toBe('a/b/c')
  })

  testIf(process.platform !== 'win32')('backslashes on posix', () => {
    expect(pathToPosix('a\\b\\c')).toBe('a\\b\\c')
  })
})

describe('longestCommonPathPrefix', () => {
  describeIf(process.platform !== 'win32')('posix', () => {
    test('common ancestor directory', () => {
      expect(longestCommonPathPrefix('/usr/lib/libprisma.so', '/usr/bin/prisma')).toBe('/usr')
    })

    test('common ancestor is root', () => {
      expect(longestCommonPathPrefix('/usr/bin/prisma', '/home/prisma')).toBe('/')
    })

    test('common ancestor is the path itself', () => {
      expect(longestCommonPathPrefix('/home/prisma', '/home/prisma')).toBe('/home/prisma')
    })

    test('substring is not treated as a path component', () => {
      expect(longestCommonPathPrefix('/prisma', '/pri')).toBe('/')
    })
  })

  describeIf(process.platform === 'win32')('windows', () => {
    test('common ancestor directory', () => {
      expect(longestCommonPathPrefix('C:\\Common\\A\\Prisma', 'C:\\Common\\B\\Prisma')).toBe('C:\\Common')
    })

    test('common ancestor is disk', () => {
      expect(longestCommonPathPrefix('C:\\A\\Prisma', 'C:\\B\\Prisma')).toBe('C:\\')
    })

    test('substring is not treated as a path component', () => {
      expect(longestCommonPathPrefix('C:\\Prisma', 'C:\\Pri')).toBe('C:\\')
    })

    test('namespaced path works', () => {
      expect(longestCommonPathPrefix('C:\\Common\\A\\Prisma', '\\\\?\\C:\\Common\\B\\Prisma')).toBe('\\\\?\\C:\\Common')
    })

    test('different disks', () => {
      expect(longestCommonPathPrefix('C:\\Prisma', 'D:\\Prisma')).toBeUndefined()
      expect(longestCommonPathPrefix('\\\\?\\C:\\Prisma', '\\\\?\\D:\\Prisma')).toBeUndefined()
    })

    test('different namespaces', () => {
      expect(longestCommonPathPrefix('\\\\?\\C:\\Prisma', '\\\\.\\COM1')).toBeUndefined()
    })
  })
})
