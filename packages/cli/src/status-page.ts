import { bold, dim, green, red, yellow } from 'kleur/colors'
import { z } from 'zod'

export const STATUS_PAGE_URL = 'https://www.prisma-status.com'
const SUMMARY_API_URL = `${STATUS_PAGE_URL}/api/v2/summary.json`

const StatusPageStatusSchema = z
  .object({
    indicator: z.enum(['none', 'minor', 'major', 'critical']),
    description: z.string(),
  })
  .passthrough()

const StatusPageComponentSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    status: z.enum(['operational', 'degraded_performance', 'partial_outage', 'major_outage', 'under_maintenance']),
    description: z.string().nullable(),
    position: z.number(),
    group_id: z.string().nullable(),
    group: z.boolean(),
  })
  .passthrough()

const StatusPageIncidentUpdateSchema = z
  .object({
    status: z.string(),
    body: z.string(),
    created_at: z.string(),
  })
  .passthrough()

const StatusPageIncidentSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    status: z.string(),
    impact: z.enum(['none', 'minor', 'major', 'critical']),
    created_at: z.string(),
    incident_updates: z.array(StatusPageIncidentUpdateSchema),
  })
  .passthrough()

const StatusPageMaintenanceSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    status: z.enum(['scheduled', 'in_progress', 'verifying', 'completed']),
    scheduled_for: z.string(),
    scheduled_until: z.string(),
    incident_updates: z.array(StatusPageIncidentUpdateSchema),
  })
  .passthrough()

const StatusPageSummarySchema = z
  .object({
    status: StatusPageStatusSchema,
    components: z.array(StatusPageComponentSchema),
    incidents: z.array(StatusPageIncidentSchema),
    scheduled_maintenances: z.array(StatusPageMaintenanceSchema),
  })
  .passthrough()

export type StatusPageStatus = z.infer<typeof StatusPageStatusSchema>
export type StatusPageComponent = z.infer<typeof StatusPageComponentSchema>
export type StatusPageIncidentUpdate = z.infer<typeof StatusPageIncidentUpdateSchema>
export type StatusPageIncident = z.infer<typeof StatusPageIncidentSchema>
export type StatusPageMaintenance = z.infer<typeof StatusPageMaintenanceSchema>
export type StatusPageSummary = z.infer<typeof StatusPageSummarySchema>

export function formatComponentStatus(status: StatusPageComponent['status']): string {
  switch (status) {
    case 'operational':
      return green('Operational')
    case 'degraded_performance':
      return yellow('Degraded')
    case 'partial_outage':
      return yellow('Partial Outage')
    case 'major_outage':
      return red('Major Outage')
    case 'under_maintenance':
      return yellow('Maintenance')
    default:
      return status
  }
}

export function formatOverallStatus(indicator: StatusPageStatus['indicator'], description: string): string {
  switch (indicator) {
    case 'none':
      return green(description)
    case 'minor':
      return yellow(description)
    case 'major':
    case 'critical':
      return red(description)
    default:
      return description
  }
}

export function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (seconds < 60) return '<1m ago'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function formatMaintenanceStatus(status: StatusPageMaintenance['status']): string {
  switch (status) {
    case 'scheduled':
      return 'Scheduled'
    case 'in_progress':
      return 'In Progress'
    case 'verifying':
      return 'Verifying'
    case 'completed':
      return 'Completed'
    default:
      return status
  }
}

export function formatTimeWindow(start: string, end: string): string {
  const startDate = new Date(start)
  const endDate = new Date(end)
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }
  const timeOpts: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' }
  const date = startDate.toLocaleDateString('en-US', opts)
  const startTime = startDate.toLocaleTimeString('en-US', timeOpts)
  const endTime = endDate.toLocaleTimeString('en-US', timeOpts)
  return `${date} ${startTime}-${endTime} UTC`
}

export function latestUpdate(updates: StatusPageIncidentUpdate[]): StatusPageIncidentUpdate | undefined {
  return updates.toSorted((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0]
}

export function stripPrismaPrefix(name: string): string {
  return name.replace(/^Prisma\s+/, '')
}

type StatusResult =
  | { summary: StatusPageSummary }
  | { httpError: number }
  | { networkError: string }
  | { parseError: string }

async function queryStatusAPI(): Promise<StatusResult> {
  try {
    const response = await fetch(SUMMARY_API_URL, { signal: AbortSignal.timeout(10_000) })
    if (!response.ok) return { httpError: response.status }
    const parsed = StatusPageSummarySchema.safeParse(await response.json())
    if (!parsed.success) return { parseError: `unexpected API response: ${parsed.error.message}` }
    return { summary: parsed.data }
  } catch (e) {
    return { networkError: e instanceof Error ? e.message : String(e) }
  }
}

/** Fetches status from the Prisma status page API and returns formatted output. */
export async function fetchStatus(isJson: boolean): Promise<string> {
  const result = await queryStatusAPI()

  if (isJson) {
    if ('networkError' in result) {
      process.exitCode = 1
      return JSON.stringify({ error: result.networkError })
    }
    if ('parseError' in result) {
      process.exitCode = 1
      return JSON.stringify({ error: result.parseError })
    }
    if ('httpError' in result) {
      process.exitCode = 1
      return JSON.stringify({ error: `Status API returned HTTP ${result.httpError}` })
    }
    return JSON.stringify(result.summary, null, 2)
  }

  if ('networkError' in result) {
    return `${red('Could not reach status API')}: ${result.networkError}\nCheck ${STATUS_PAGE_URL} directly.`
  }
  if ('parseError' in result) {
    return `${red('Could not parse status API response')}: ${result.parseError}\nCheck ${STATUS_PAGE_URL} directly.`
  }
  if ('httpError' in result) {
    return `${red(`Status API returned HTTP ${result.httpError}`)}\nCheck ${STATUS_PAGE_URL} directly.`
  }

  const { summary } = result
  const lines: string[] = []

  lines.push(bold(formatOverallStatus(summary.status.indicator, summary.status.description)))
  lines.push('')

  const components = summary.components.filter((c) => !c.group).sort((a, b) => a.position - b.position)

  if (components.length > 0) {
    lines.push(bold('Services'))
    const maxNameLen = Math.max(...components.map((c) => stripPrismaPrefix(c.name).length))
    for (const component of components) {
      const name = stripPrismaPrefix(component.name).padEnd(maxNameLen)
      lines.push(`  ${name}   ${formatComponentStatus(component.status)}`)
    }
  }

  if (summary.incidents.length > 0) {
    lines.push('')
    lines.push(bold('Active Incidents'))
    for (const incident of summary.incidents) {
      const impact =
        incident.impact === 'critical' || incident.impact === 'major' ? red(incident.impact) : yellow(incident.impact)
      lines.push(`  ${impact} ${incident.name} (${timeAgo(incident.created_at)})`)
      const update = latestUpdate(incident.incident_updates)
      if (update) {
        lines.push(`    ${dim(update.status + ':')} ${update.body}`)
      }
    }
  }

  const activeMaint = summary.scheduled_maintenances.filter((m) => m.status !== 'completed')
  if (activeMaint.length > 0) {
    lines.push('')
    lines.push(bold('Scheduled Maintenances'))
    for (const maint of activeMaint) {
      const statusLabel = formatMaintenanceStatus(maint.status)
      lines.push(`  ${maint.name} ${dim(`(${statusLabel})`)}`)

      // prefer scheduled update (has details) over latest status update
      const scheduledUpdate = maint.incident_updates.find((u) => u.status === 'scheduled')
      const updateToShow = scheduledUpdate ?? latestUpdate(maint.incident_updates)
      if (updateToShow?.body) {
        for (const line of updateToShow.body.split('\n')) {
          lines.push(`    ${line}`)
        }
      }

      if (maint.scheduled_for && maint.scheduled_until) {
        lines.push(`    ${formatTimeWindow(maint.scheduled_for, maint.scheduled_until)}`)
      }
    }
  }

  lines.push('')
  lines.push(`Status page: ${dim(STATUS_PAGE_URL)}`)

  return lines.join('\n')
}
