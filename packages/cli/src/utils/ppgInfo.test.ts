import { ServerState } from '@prisma/dev/internal/state'

import { getPpgInfo } from './ppgInfo'

jest.mock('@prisma/dev/internal/state', () => ({
  ServerState: {
    scan: jest.fn(),
  },
}))

describe('getPpgInfo', () => {
  let mockScan: jest.MockedFunction<typeof ServerState.scan>

  beforeEach(() => {
    jest.clearAllMocks()
    // eslint-disable-next-line @typescript-eslint/unbound-method
    mockScan = jest.mocked(ServerState.scan)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('remote connections', () => {
    it('prisma+postgres with accelerate.prisma-data.net => remote', async () => {
      const result = await getPpgInfo('prisma+postgres://accelerate.prisma-data.net/db?api_key=test')
      expect(result).toEqual({ ppg: { type: 'remote' } })
      expect(mockScan).not.toHaveBeenCalled()
    })

    it('postgres with db.prisma.io => remote', async () => {
      const result = await getPpgInfo('postgres://db.prisma.io/db?api_key=test')
      expect(result).toEqual({ ppg: { type: 'remote' } })
      expect(mockScan).not.toHaveBeenCalled()
    })

    it('postgresql with db.prisma.io => remote', async () => {
      const result = await getPpgInfo('postgresql://db.prisma.io/db?api_key=test')
      expect(result).toEqual({ ppg: { type: 'remote' } })
      expect(mockScan).not.toHaveBeenCalled()
    })
  })

  describe('local connections', () => {
    it('prisma+postgres with localhost => local', async () => {
      const result = await getPpgInfo('prisma+postgres://localhost:5432/db?api_key=test')
      expect(result).toEqual({ ppg: { type: 'local' } })
      expect(mockScan).not.toHaveBeenCalled()
    })

    it('prisma+postgres with 127.0.0.1 => local', async () => {
      const result = await getPpgInfo('prisma+postgres://127.0.0.1:5432/db?api_key=test')
      expect(result).toEqual({ ppg: { type: 'local' } })
      expect(mockScan).not.toHaveBeenCalled()
    })

    it('postgres & localhost & local ppg server databasePort => local', async () => {
      mockScan.mockResolvedValue([
        {
          databasePort: 5432,
          shadowDatabasePort: 5433,
          name: 'test-server',
          port: 51213,
          version: '1' as const,
          status: 'running' as const,
        },
      ])

      const result = await getPpgInfo('postgres://localhost:5432/db')
      expect(result).toEqual({ ppg: { type: 'local' } })
      expect(mockScan).toHaveBeenCalledTimes(1)
    })

    it('postgresql & localhost & local ppg server databasePort => local', async () => {
      mockScan.mockResolvedValue([
        {
          databasePort: 5432,
          shadowDatabasePort: 5433,
          name: 'test-server',
          port: 51213,
          version: '1' as const,
          status: 'running' as const,
        },
      ])

      const result = await getPpgInfo('postgresql://localhost:5432/db')
      expect(result).toEqual({ ppg: { type: 'local' } })
      expect(mockScan).toHaveBeenCalledTimes(1)
    })

    it('postgres & localhost & local ppg server shadowDatabasePort => local', async () => {
      mockScan.mockResolvedValue([
        {
          databasePort: 5432,
          shadowDatabasePort: 5433,
          name: 'test-server',
          port: 51213,
          version: '1' as const,
          status: 'running' as const,
        },
      ])

      const result = await getPpgInfo('postgres://localhost:5433/db')
      expect(result).toEqual({ ppg: { type: 'local' } })
      expect(mockScan).toHaveBeenCalledTimes(1)
    })

    it('postgres & 127.0.0.1 & local ppg server databasePort => local', async () => {
      mockScan.mockResolvedValue([
        {
          databasePort: 5432,
          shadowDatabasePort: 5433,
          name: 'test-server',
          port: 51213,
          version: '1' as const,
          status: 'running' as const,
        },
      ])

      const result = await getPpgInfo('postgres://127.0.0.1:5432/db')
      expect(result).toEqual({ ppg: { type: 'local' } })
      expect(mockScan).toHaveBeenCalledTimes(1)
    })

    it('postgres & ::1 & local ppg server databasePort => local', async () => {
      mockScan.mockResolvedValue([
        {
          databasePort: 5432,
          shadowDatabasePort: 5433,
          name: 'test-server',
          port: 51213,
          version: '1' as const,
          status: 'running' as const,
        },
      ])

      const result = await getPpgInfo('postgres://[::1]:5432/db')
      expect(result).toEqual({ ppg: { type: 'local' } })
      expect(mockScan).toHaveBeenCalledTimes(1)
    })

    it('postgres & 0:0:0:0:0:0:0:1 & local ppg server databasePort => local', async () => {
      mockScan.mockResolvedValue([
        {
          databasePort: 5432,
          shadowDatabasePort: 5433,
          name: 'test-server',
          port: 51213,
          version: '1' as const,
          status: 'running' as const,
        },
      ])

      const result = await getPpgInfo('postgres://[0:0:0:0:0:0:0:1]:5432/db')
      expect(result).toEqual({ ppg: { type: 'local' } })
      expect(mockScan).toHaveBeenCalledTimes(1)
    })
  })

  describe('unmatched connections', () => {
    it('postgres & localhost & port does not match local ppg server => no ppg info', async () => {
      mockScan.mockResolvedValue([
        {
          databasePort: 5432,
          shadowDatabasePort: 5433,
          name: 'test-server',
          port: 51213,
          version: '1' as const,
          status: 'running' as const,
        },
      ])

      const result = await getPpgInfo('postgres://localhost:9999/db')
      expect(result).toEqual({})
      expect(mockScan).toHaveBeenCalledTimes(1)
    })

    it('postgres & localhost & no local ppg servers => no ppg info', async () => {
      mockScan.mockResolvedValue([])

      const result = await getPpgInfo('postgres://localhost:5432/db')
      expect(result).toEqual({})
      expect(mockScan).toHaveBeenCalledTimes(1)
    })

    it('should return no ppg info for non-matching remote host', async () => {
      const result = await getPpgInfo('postgres://example.com:5432/db')
      expect(result).toEqual({})
      expect(mockScan).not.toHaveBeenCalled()
    })

    it('should return no ppg info for non-postgres protocol', async () => {
      const result = await getPpgInfo('mysql://localhost:3306/db')
      expect(result).toEqual({})
      expect(mockScan).not.toHaveBeenCalled()
    })
  })
})
