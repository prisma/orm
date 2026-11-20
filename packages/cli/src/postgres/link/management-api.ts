import { hostname } from 'node:os'

import type { ManagementApiClient } from '@prisma/management-api-sdk'

export interface ConnectionResult {
  connectionString: string
}

export class LinkApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
  ) {
    super(message)
    this.name = 'LinkApiError'
  }
}

export function sanitizeErrorMessage(message: string): string {
  return message
    .replace(/postgres(ql)?:\/\/[^\s"']+/gi, '[REDACTED_URL]')
    .replace(/prisma\+postgres:\/\/[^\s"']+/gi, '[REDACTED_URL]')
    .replace(/(--api-key\s+)"[^"]*"/g, '$1"[REDACTED]"')
    .replace(/(--api-key\s+)(\S+)/g, '$1[REDACTED]')
}

function getConnectionName(): string {
  return `dev-${hostname()}`
}

export async function createDevConnection(client: ManagementApiClient, databaseId: string): Promise<ConnectionResult> {
  const { data, error } = await client.POST('/v1/databases/{databaseId}/connections', {
    params: { path: { databaseId } },
    body: { name: getConnectionName() },
  })

  if (error) {
    const code = error.error?.code
    const msg = typeof error.error?.message === 'string' ? error.error.message : 'Failed to create connection'

    if (code === 'unauthorized' || code === 'authentication-failed') {
      throw new LinkApiError('Invalid credentials — check your API key or re-authenticate via browser.', 401)
    }
    if (code === 'not_found') {
      throw new LinkApiError(`Database "${databaseId}" not found — check the database ID in your console.`, 404)
    }

    throw new LinkApiError(msg)
  }

  const endpoints = data?.data?.endpoints
  const connectionString =
    endpoints?.direct?.connectionString ?? endpoints?.pooled?.connectionString ?? data?.data?.connectionString

  if (!connectionString) {
    throw new LinkApiError('No connection string found in API response')
  }

  return { connectionString }
}

export async function listProjects(client: ManagementApiClient) {
  const { data, error } = await client.GET('/v1/projects')

  if (error) {
    const msg = typeof error.error?.message === 'string' ? error.error.message : 'Failed to list projects'
    throw new LinkApiError(msg)
  }

  return data?.data ?? []
}

export async function listDatabases(client: ManagementApiClient, projectId: string) {
  const { data, error } = await client.GET('/v1/databases', {
    params: { query: { projectId } },
  })

  if (error) {
    const msg = typeof error.error?.message === 'string' ? error.error.message : 'Failed to list databases'
    throw new LinkApiError(msg)
  }

  return data?.data ?? []
}

export async function getDatabase(client: ManagementApiClient, databaseId: string) {
  const { data, error } = await client.GET('/v1/databases/{databaseId}', {
    params: { path: { databaseId } },
  })

  if (error) {
    const msg = typeof error.error?.message === 'string' ? error.error.message : 'Failed to get database'
    throw new LinkApiError(msg)
  }

  return data?.data ?? null
}
