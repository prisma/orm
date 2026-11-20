import { stripVTControlCharacters } from 'node:util'

import { defaultTestConfig } from '@prisma/config'

import { Status } from '../../Status'

function makeSummary(overrides: Record<string, unknown> = {}) {
  return {
    status: { indicator: 'none', description: 'All Systems Operational' },
    components: [
      {
        id: '1',
        name: 'Prisma Accelerate',
        status: 'operational',
        position: 1,
        group: false,
        group_id: null,
        description: null,
      },
      {
        id: '2',
        name: 'Prisma Console',
        status: 'operational',
        position: 2,
        group: false,
        group_id: null,
        description: null,
      },
      {
        id: '3',
        name: 'Prisma Optimize',
        status: 'operational',
        position: 3,
        group: false,
        group_id: null,
        description: null,
      },
      {
        id: '4',
        name: 'Prisma Postgres',
        status: 'operational',
        position: 4,
        group: false,
        group_id: null,
        description: null,
      },
    ],
    incidents: [],
    scheduled_maintenances: [],
    ...overrides,
  }
}

describe('status', () => {
  let fetchSpy: jest.SpyInstance

  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis as any, 'fetch')
  })

  afterEach(() => {
    fetchSpy.mockRestore()
    process.exitCode = undefined
  })

  function mockFetchSuccess(data: unknown) {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(data),
    })
  }

  function mockFetchHttpError(status: number) {
    fetchSpy.mockResolvedValue({
      ok: false,
      status,
      json: () => Promise.resolve({}),
    })
  }

  function mockFetchNetworkError(message: string) {
    fetchSpy.mockRejectedValue(new Error(message))
  }

  function mockFetchParseError() {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ unexpected: 'response' }),
    })
  }

  it('should show help with --help', async () => {
    const result = await Status.new('prisma').parse(['--help'], defaultTestConfig())
    expect(result).toContain('Show Prisma Data Platform service status')
    expect(result).toContain('--json')
  })

  it('should display all operational services', async () => {
    mockFetchSuccess(makeSummary())

    const result = stripVTControlCharacters((await Status.new('prisma').parse([], defaultTestConfig())) as string)

    expect(result).toMatchInlineSnapshot(`
      "All Systems Operational

      Services
        Accelerate   Operational
        Console      Operational
        Optimize     Operational
        Postgres     Operational

      Status page: https://www.prisma-status.com"
    `)
  })

  it('should display active incidents', async () => {
    mockFetchSuccess(
      makeSummary({
        status: { indicator: 'major', description: 'Major System Outage' },
        components: [
          {
            id: '1',
            name: 'Prisma Accelerate',
            status: 'degraded_performance',
            position: 1,
            group: false,
            group_id: null,
            description: null,
          },
        ],
        incidents: [
          {
            id: 'inc1',
            name: 'Accelerate degraded performance',
            status: 'investigating',
            impact: 'major',
            created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
            incident_updates: [
              { status: 'investigating', body: 'Looking into it.', created_at: new Date().toISOString() },
            ],
          },
        ],
      }),
    )

    const result = stripVTControlCharacters((await Status.new('prisma').parse([], defaultTestConfig())) as string)

    expect(result).toContain('Major System Outage')
    expect(result).toContain('Degraded')
    expect(result).toContain('Active Incidents')
    expect(result).toContain('major')
    expect(result).toContain('Accelerate degraded performance')
    expect(result).toContain('2h ago')
    expect(result).toContain('investigating:')
    expect(result).toContain('Looking into it.')
  })

  it('should show latest incident update when API returns oldest-first', async () => {
    mockFetchSuccess(
      makeSummary({
        status: { indicator: 'minor', description: 'Minor Service Outage' },
        incidents: [
          {
            id: 'inc1',
            name: 'Elevated error rates',
            status: 'monitoring',
            impact: 'minor',
            created_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
            incident_updates: [
              { status: 'investigating', body: 'Initial report.', created_at: '2026-02-17T10:00:00Z' },
              { status: 'identified', body: 'Root cause found.', created_at: '2026-02-17T10:30:00Z' },
              { status: 'monitoring', body: 'Fix deployed, monitoring.', created_at: '2026-02-17T11:00:00Z' },
            ],
          },
        ],
      }),
    )

    const result = stripVTControlCharacters((await Status.new('prisma').parse([], defaultTestConfig())) as string)

    expect(result).toContain('monitoring:')
    expect(result).toContain('Fix deployed, monitoring.')
    expect(result).not.toContain('Initial report.')
  })

  it('should display scheduled maintenances and hide completed ones', async () => {
    mockFetchSuccess(
      makeSummary({
        scheduled_maintenances: [
          {
            id: 'm1',
            name: 'Database migration',
            status: 'scheduled',
            scheduled_for: '2026-02-17T09:30:00.000Z',
            scheduled_until: '2026-02-17T10:30:00.000Z',
            incident_updates: [
              { status: 'scheduled', body: 'Planned downtime.', created_at: new Date().toISOString() },
            ],
          },
          {
            id: 'm2',
            name: 'Old maintenance',
            status: 'completed',
            scheduled_for: '2026-02-16T09:30:00.000Z',
            scheduled_until: '2026-02-16T10:30:00.000Z',
            incident_updates: [],
          },
        ],
      }),
    )

    const result = stripVTControlCharacters((await Status.new('prisma').parse([], defaultTestConfig())) as string)

    expect(result).toMatchInlineSnapshot(`
      "All Systems Operational

      Services
        Accelerate   Operational
        Console      Operational
        Optimize     Operational
        Postgres     Operational

      Scheduled Maintenances
        Database migration (Scheduled)
          Planned downtime.
          Feb 17, 2026 09:30-10:30 UTC

      Status page: https://www.prisma-status.com"
    `)
  })

  it('should show under_maintenance status as Maintenance', async () => {
    mockFetchSuccess(
      makeSummary({
        components: [
          {
            id: '1',
            name: 'Prisma Postgres',
            status: 'under_maintenance',
            position: 1,
            group: false,
            group_id: null,
            description: null,
          },
        ],
      }),
    )

    const result = stripVTControlCharacters((await Status.new('prisma').parse([], defaultTestConfig())) as string)

    expect(result).toMatchInlineSnapshot(`
      "All Systems Operational

      Services
        Postgres   Maintenance

      Status page: https://www.prisma-status.com"
    `)
  })

  it('should display in_progress maintenance preferring scheduled update body', async () => {
    mockFetchSuccess(
      makeSummary({
        scheduled_maintenances: [
          {
            id: 'm1',
            name: 'Prisma Postgres Maintenance',
            status: 'in_progress',
            scheduled_for: '2026-02-17T09:30:00.000Z',
            scheduled_until: '2026-02-17T10:30:00.000Z',
            incident_updates: [
              { status: 'in_progress', body: 'Maintenance in progress.', created_at: new Date().toISOString() },
              {
                status: 'scheduled',
                body: 'Impact: Active connections may be disrupted.',
                created_at: new Date().toISOString(),
              },
            ],
          },
        ],
      }),
    )

    const result = stripVTControlCharacters((await Status.new('prisma').parse([], defaultTestConfig())) as string)

    expect(result).toMatchInlineSnapshot(`
      "All Systems Operational

      Services
        Accelerate   Operational
        Console      Operational
        Optimize     Operational
        Postgres     Operational

      Scheduled Maintenances
        Prisma Postgres Maintenance (In Progress)
          Impact: Active connections may be disrupted.
          Feb 17, 2026 09:30-10:30 UTC

      Status page: https://www.prisma-status.com"
    `)
  })

  it('should output raw JSON with --json', async () => {
    const summary = makeSummary()
    mockFetchSuccess(summary)

    const result = (await Status.new('prisma').parse(['--json'], defaultTestConfig())) as string
    const parsed = JSON.parse(result)

    expect(parsed.status.indicator).toBe('none')
    expect(parsed.components).toHaveLength(4)
  })

  it('should handle network errors gracefully', async () => {
    mockFetchNetworkError('fetch failed')

    const result = stripVTControlCharacters((await Status.new('prisma').parse([], defaultTestConfig())) as string)

    expect(result).toContain('Could not reach status API')
    expect(result).toContain('fetch failed')
    expect(result).toContain('https://www.prisma-status.com')
  })

  it('should return JSON error on network failure with --json and set non-zero exit code', async () => {
    mockFetchNetworkError('timeout')

    const result = (await Status.new('prisma').parse(['--json'], defaultTestConfig())) as string
    const parsed = JSON.parse(result)

    expect(parsed.error).toBe('timeout')
    expect(process.exitCode).toBe(1)
  })

  it('should handle HTTP errors gracefully', async () => {
    mockFetchHttpError(503)

    const result = stripVTControlCharacters((await Status.new('prisma').parse([], defaultTestConfig())) as string)

    expect(result).toContain('Status API returned HTTP 503')
    expect(result).toContain('https://www.prisma-status.com')
  })

  it('should return JSON error on HTTP failure with --json and set non-zero exit code', async () => {
    mockFetchHttpError(500)

    const result = (await Status.new('prisma').parse(['--json'], defaultTestConfig())) as string
    const parsed = JSON.parse(result)

    expect(parsed.error).toBe('Status API returned HTTP 500')
    expect(process.exitCode).toBe(1)
  })

  it('should handle parse errors gracefully', async () => {
    mockFetchParseError()

    const result = stripVTControlCharacters((await Status.new('prisma').parse([], defaultTestConfig())) as string)

    expect(result).toContain('Could not parse status API response')
    expect(result).toContain('unexpected API response')
    expect(result).toContain('https://www.prisma-status.com')
  })

  it('should return JSON error on parse failure with --json and set non-zero exit code', async () => {
    mockFetchParseError()

    const result = (await Status.new('prisma').parse(['--json'], defaultTestConfig())) as string
    const parsed = JSON.parse(result)

    expect(parsed.error).toContain('unexpected API response')
    expect(process.exitCode).toBe(1)
  })

  it('should filter out group components', async () => {
    mockFetchSuccess(
      makeSummary({
        components: [
          {
            id: 'g1',
            name: 'Group',
            status: 'operational',
            position: 0,
            group: true,
            group_id: null,
            description: null,
          },
          {
            id: '1',
            name: 'Prisma Accelerate',
            status: 'operational',
            position: 1,
            group: false,
            group_id: 'g1',
            description: null,
          },
        ],
      }),
    )

    const result = stripVTControlCharacters((await Status.new('prisma').parse([], defaultTestConfig())) as string)

    expect(result).toMatchInlineSnapshot(`
      "All Systems Operational

      Services
        Accelerate   Operational

      Status page: https://www.prisma-status.com"
    `)
  })
})
