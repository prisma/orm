import { afterEach, describe, expect, it, vi } from 'vitest'

import { computeLibSSLSpecificPaths, getArchFromUname, getSSLVersion } from '../getPlatform'
import { vitestContext } from '../test-utils/vitestContext'

const describeIf = (condition: boolean) => (condition ? describe : describe.skip)

const ctx = vitestContext.new().assemble()

describeIf(process.platform === 'linux')('computeLibSSLSpecificPaths', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('should not return an error', () => {
    const arch = 'x64'
    const archFromUname = 'x86_64'
    computeLibSSLSpecificPaths({ familyDistro: 'debian', arch, archFromUname })
  })

  it('returns alpine paths for alpine family', () => {
    expect(computeLibSSLSpecificPaths({ familyDistro: 'alpine', arch: 'x64', archFromUname: 'x86_64' })).toEqual([
      '/lib',
      '/usr/lib',
    ])
  })

  it('reads nix-ld library path on nixos', () => {
    vi.stubEnv('NIX_LD_LIBRARY_PATH', '/run/current-system/sw/share/nix-ld/lib:/nix/store/abc-openssl-3.0.x/lib')
    vi.stubEnv('LD_LIBRARY_PATH', '')
    expect(computeLibSSLSpecificPaths({ familyDistro: 'nixos', arch: 'x64', archFromUname: 'x86_64' })).toEqual([
      '/run/current-system/sw/share/nix-ld/lib',
      '/nix/store/abc-openssl-3.0.x/lib',
    ])
  })

  it('returns no paths on nixos without nix-ld', () => {
    vi.stubEnv('NIX_LD_LIBRARY_PATH', '')
    vi.stubEnv('LD_LIBRARY_PATH', '')
    expect(computeLibSSLSpecificPaths({ familyDistro: 'nixos', arch: 'x64', archFromUname: 'x86_64' })).toEqual([])
  })
})

describeIf(process.platform === 'linux')('getSSLVersion', () => {
  it('should not return an error', async () => {
    const archFromUname = await getArchFromUname()
    await getSSLVersion([])
    await getSSLVersion(['/lib64'])
    await getSSLVersion([`/usr/lib/${archFromUname}-linux-gnu`])
  })

  describe('strategy: "libssl-specific-path"', () => {
    const focusedStrategy = 'libssl-specific-path'

    it('falls back with nss only', async () => {
      ctx.fixture('libssl-specific-path/with-nss-only')
      const { strategy } = await getSSLVersion([ctx.tmpDir])
      expect(strategy).not.toEqual(focusedStrategy)
    })

    it('falls back with unknown versions only', async () => {
      ctx.fixture('libssl-specific-path/with-unknown-versions-only')
      const { strategy } = await getSSLVersion([ctx.tmpDir])
      expect(strategy).not.toEqual(focusedStrategy)
    })

    it("falls back with a path that's not a dir", async () => {
      ctx.fixture('libssl-specific-path/with-libssl-0')
      const { strategy } = await getSSLVersion([`${ctx.tmpDir}/libssl.so.3`])
      expect(strategy).not.toEqual(focusedStrategy)
    })

    it('selects the oldest libssl version, excluding libssl-0.x.x', async () => {
      ctx.fixture('libssl-specific-path/with-libssl-0')
      const { libssl, strategy } = await getSSLVersion([ctx.tmpDir])
      expect(strategy).toEqual(focusedStrategy)
      expect(libssl).toEqual('1.0.x')
    })

    it('skips libssl.so without version in filename', async () => {
      ctx.fixture('libssl-specific-path/with-versionless-libssl')
      const { libssl, strategy } = await getSSLVersion([ctx.tmpDir])
      expect(strategy).toEqual(focusedStrategy)
      expect(libssl).toEqual('1.0.x')
    })
  })
})
