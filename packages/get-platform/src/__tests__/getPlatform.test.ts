import { stripVTControlCharacters } from 'node:util'

import { describe, expect, it } from 'vitest'

import { getBinaryTargetForCurrentPlatformInternal, getPlatformInfoMemoized } from '../getPlatform'
import { vitestConsoleContext, vitestContext } from '../test-utils/vitestContext'

const ctx = vitestContext.new().add(vitestConsoleContext()).assemble()

describe('getPlatformInfoMemoized', () => {
  it('repeated invocations are idempotent and memoized', async () => {
    const platformFirst = await getPlatformInfoMemoized()
    const platformSecond = await getPlatformInfoMemoized()
    expect(platformFirst.binaryTarget).toBe(platformSecond.binaryTarget)
    expect(platformFirst.memoized).toBeFalsy()
    expect(platformSecond.memoized).toBeTruthy()
    expect(ctx.mocked['console.log'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
    expect(ctx.mocked['console.warn'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
    expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
  })
})

describe('getBinaryTargetForCurrentPlatformInternal', () => {
  describe('linux', () => {
    const platform = 'linux'

    // test name convention: <originalDistro> (<familyDistro>), <arch> (<uname -m>), openssl-<libssl>

    it('debian (debian), amd64 (x86_64), openssl-1.1.x', () => {
      expect(
        getBinaryTargetForCurrentPlatformInternal({
          platform,
          libssl: '1.1.x',
          arch: 'x64',
          archFromUname: 'x86_64',
          familyDistro: 'debian',
          originalDistro: 'debian',
          targetDistro: 'debian',
        }),
      ).toBe('debian-openssl-1.1.x')
      expect(ctx.mocked['console.log'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
      expect(ctx.mocked['console.warn'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
      expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
    })

    it('opensuse (suse), amd64 (x86_64), openssl-1.1.x', () => {
      expect(
        getBinaryTargetForCurrentPlatformInternal({
          platform,
          libssl: '1.1.x',
          arch: 'x64',
          archFromUname: 'x86_64',
          familyDistro: 'rhel',
          originalDistro: 'opensuse-tumbleweed',
          targetDistro: 'rhel',
        }),
      ).toBe('rhel-openssl-1.1.x')
      expect(ctx.mocked['console.log'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
      expect(ctx.mocked['console.warn'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
      expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
    })

    it('alpine (alpine), amd64 (x86_64), openssl-3.0.x', () => {
      expect(
        getBinaryTargetForCurrentPlatformInternal({
          platform,
          libssl: '3.0.x',
          arch: 'x64',
          archFromUname: 'x86_64',
          familyDistro: 'alpine',
          originalDistro: 'alpine',
          targetDistro: 'musl',
        }),
      ).toBe('linux-musl-openssl-3.0.x')
      expect(ctx.mocked['console.log'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
      expect(ctx.mocked['console.warn'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
      expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
    })

    it('alpine (alpine), arm64 (aarch64), openssl-3.0.x', () => {
      expect(
        getBinaryTargetForCurrentPlatformInternal({
          platform,
          libssl: '3.0.x',
          arch: 'arm64',
          archFromUname: 'aarch64',
          familyDistro: 'alpine',
          originalDistro: 'alpine',
          targetDistro: 'musl',
        }),
      ).toBe('linux-musl-arm64-openssl-3.0.x')
      expect(ctx.mocked['console.log'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
      expect(ctx.mocked['console.warn'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
      expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
    })

    it('alpine (alpine), arm (armv7l), openssl-3.0.x', () => {
      expect(
        getBinaryTargetForCurrentPlatformInternal({
          platform,
          libssl: '3.0.x',
          arch: 'arm',
          archFromUname: 'armv7l',
          familyDistro: 'alpine',
          originalDistro: 'alpine',
          targetDistro: 'musl',
        }),
      ).toBe('linux-arm-openssl-3.0.x')
      expect(ctx.mocked['console.log'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
      // TODO: can't currently use `toMatchInlineSnaphost` here because our snaphost serialiser replaces "arm" with
      // "TEST_PLATFORM" unnecessarily.
      expect(stripVTControlCharacters(ctx.mocked['console.warn'].mock.calls.join('\n') as string)).toBe(
        `prisma:warn Prisma only officially supports Linux on amd64 (x86_64) and arm64 (aarch64) system architectures (detected "arm" instead). If you are using your own custom Prisma engines, you can ignore this warning, as long as you've compiled the engines for your system architecture "armv7l".`,
      )
      expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
    })

    it('ubuntu (debian), amd64 (x86_64), openssl-undefined', () => {
      expect(
        getBinaryTargetForCurrentPlatformInternal({
          platform,
          libssl: undefined,
          arch: 'x64',
          archFromUname: 'x86_64',
          familyDistro: 'debian',
          originalDistro: 'ubuntu',
          targetDistro: 'debian',
        }),
      ).toBe('debian-openssl-1.1.x')
      expect(ctx.mocked['console.log'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
      expect(ctx.mocked['console.warn'].mock.calls.join('\n')).toMatchInlineSnapshot(`
        "prisma:warn Prisma failed to detect the libssl/openssl version to use, and may not work as expected. Defaulting to "openssl-1.1.x".
        Please manually install OpenSSL via \`apt-get update -y && apt-get install -y openssl\` and try installing Prisma again. If you're running Prisma on Docker, add this command to your Dockerfile, or switch to an image that already has OpenSSL installed."
      `)
      expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
    })

    it('arch (arch), amd64 (x86_64), openssl-undefined', () => {
      expect(
        getBinaryTargetForCurrentPlatformInternal({
          platform,
          libssl: undefined,
          arch: 'x64',
          archFromUname: 'x86_64',
          familyDistro: 'arch',
          originalDistro: 'arch',
          targetDistro: 'debian',
        }),
      ).toBe('debian-openssl-1.1.x')
      expect(ctx.mocked['console.log'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
      expect(ctx.mocked['console.warn'].mock.calls.join('\n')).toMatchInlineSnapshot(`
        "prisma:warn Prisma failed to detect the libssl/openssl version to use, and may not work as expected. Defaulting to "openssl-1.1.x".
        Please manually install OpenSSL and try installing Prisma again."
      `)
      expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
    })

    it('nixos (nixos), amd64 (x86_64), openssl-3.0.x', () => {
      expect(
        getBinaryTargetForCurrentPlatformInternal({
          platform,
          libssl: '3.0.x',
          arch: 'x64',
          archFromUname: 'x86_64',
          familyDistro: 'nixos',
          originalDistro: 'nixos',
          targetDistro: 'debian',
        }),
      ).toBe('debian-openssl-3.0.x')
      expect(ctx.mocked['console.log'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
      expect(ctx.mocked['console.warn'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
      expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
    })

    it('nixos (nixos), arm64 (aarch64), openssl-3.0.x', () => {
      expect(
        getBinaryTargetForCurrentPlatformInternal({
          platform,
          libssl: '3.0.x',
          arch: 'arm64',
          archFromUname: 'aarch64',
          familyDistro: 'nixos',
          originalDistro: 'nixos',
          targetDistro: 'debian',
        }),
      ).toBe('linux-arm64-openssl-3.0.x')
      expect(ctx.mocked['console.log'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
      expect(ctx.mocked['console.warn'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
      expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
    })

    it('unknown (unknown), amd64 (x86_64), openssl-3.0.x', () => {
      expect(
        getBinaryTargetForCurrentPlatformInternal({
          platform,
          libssl: '3.0.x',
          arch: 'x64',
          archFromUname: 'x86_64',
          familyDistro: undefined,
          originalDistro: 'unknown',
          targetDistro: undefined,
        }),
      ).toBe('debian-openssl-3.0.x')
      expect(ctx.mocked['console.log'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
      expect(ctx.mocked['console.warn'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
      expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
    })

    it('unknown (unknown), amd64 (x86_64), openssl-undefined', () => {
      expect(
        getBinaryTargetForCurrentPlatformInternal({
          platform,
          libssl: undefined,
          arch: 'x64',
          archFromUname: 'x86_64',
          familyDistro: undefined,
          originalDistro: 'unknown',
          targetDistro: undefined,
        }),
      ).toBe('debian-openssl-1.1.x')
      expect(ctx.mocked['console.log'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
      expect(ctx.mocked['console.warn'].mock.calls.join('\n')).toMatchInlineSnapshot(`
        "prisma:warn Prisma failed to detect the libssl/openssl version to use, and may not work as expected. Defaulting to "openssl-1.1.x".
        Please manually install OpenSSL and try installing Prisma again."
      `)
      expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
    })
  })
})
