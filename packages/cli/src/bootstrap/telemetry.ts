import type { LinkResult } from '../postgres/link/Link'
import { PosthogEventCapture, PUBLIC_POSTHOG_BOOTSTRAP_ACTIVATION_PROJECT_KEY } from '../utils/nps/capture'
import type { ProjectState } from './project-state'

function isTelemetryDisabled(): boolean {
  return Boolean(process.env.CHECKPOINT_DISABLE)
}

const eventCapture = new PosthogEventCapture(PUBLIC_POSTHOG_BOOTSTRAP_ACTIVATION_PROJECT_KEY)

interface TelemetryContext {
  distinctId: string
  databaseId: string | undefined
  linkResult: LinkResult | null
  projectState: ProjectState
}

function baseProperties(ctx: TelemetryContext): Record<string, unknown> {
  return {
    'organization-id': ctx.linkResult?.workspaceId ?? null,
    'project-id': ctx.linkResult?.projectId ?? null,
    'environment-id': ctx.linkResult?.environmentId ?? null,
    database_id: ctx.databaseId ?? ctx.linkResult?.databaseId ?? null,
    is_existing_project: ctx.projectState.hasPackageJson,
  }
}

export async function emitFlowStarted(ctx: TelemetryContext): Promise<void> {
  if (isTelemetryDisabled()) return
  try {
    await eventCapture.capture(ctx.distinctId, 'activation:cli_flow_started', baseProperties(ctx))
  } catch {
    // telemetry should never block the command
  }
}

export async function emitStepCompleted(ctx: TelemetryContext, stepName: string, durationMs: number): Promise<void> {
  if (isTelemetryDisabled()) return
  try {
    await eventCapture.capture(ctx.distinctId, 'activation:cli_step_completed', {
      ...baseProperties(ctx),
      step_name: stepName,
      duration_ms: durationMs,
    })
  } catch {
    // telemetry should never block the command
  }
}

export async function emitStepSkipped(ctx: TelemetryContext, stepName: string): Promise<void> {
  if (isTelemetryDisabled()) return
  try {
    await eventCapture.capture(ctx.distinctId, 'activation:cli_step_skipped', {
      ...baseProperties(ctx),
      step_name: stepName,
    })
  } catch {
    // telemetry should never block the command
  }
}

export async function emitStepFailed(ctx: TelemetryContext, stepName: string, error: string): Promise<void> {
  if (isTelemetryDisabled()) return
  try {
    const errorCode = error.match(/^[A-Z]\d+:|Error code: ([A-Z]\d+)/)?.[1] ?? extractErrorClass(error)
    await eventCapture.capture(ctx.distinctId, 'activation:cli_step_failed', {
      ...baseProperties(ctx),
      step_name: stepName,
      error_code: errorCode,
    })
  } catch {
    // telemetry should never block the command
  }
}

function extractErrorClass(msg: string): string {
  const prismaCode = msg.match(/P\d{4}/)?.[0]
  if (prismaCode) return prismaCode
  if (msg.includes('ENOENT')) return 'ENOENT'
  if (msg.includes('EACCES')) return 'EACCES'
  if (msg.includes('ETIMEDOUT') || msg.includes('timeout')) return 'TIMEOUT'
  if (msg.includes('datasource')) return 'DATASOURCE_CONFIG'
  if (msg.includes('authenticate') || msg.includes('credentials')) return 'AUTH'
  return 'UNKNOWN'
}

export async function emitFlowCompleted(
  ctx: TelemetryContext,
  stepsCompleted: string[],
  durationMs: number,
): Promise<void> {
  if (isTelemetryDisabled()) return
  try {
    await eventCapture.capture(ctx.distinctId, 'activation:cli_flow_completed', {
      ...baseProperties(ctx),
      steps_completed: stepsCompleted,
      duration_ms: durationMs,
    })
  } catch {
    // telemetry should never block the command
  }
}
