import { isPrismaPostgresDev, PRISMA_POSTGRES_PROTOCOL } from '@prisma/internals'

import { InvalidDatasourceError } from './errors/invalid-datasource-error'

export interface GetUrlAndApiKeyOptions {
  clientVersion: string
  accelerateUrl: string
}

export interface UrlAndApiKey {
  url: HttpUrl
  apiKey: string
}

export type HttpUrl = URL & { protocol: 'http' | 'https' }

export function getUrlAndApiKey(options: GetUrlAndApiKeyOptions): UrlAndApiKey {
  const errorInfo = { clientVersion: options.clientVersion }

  let url: URL
  try {
    url = new URL(options.accelerateUrl)
  } catch (err) {
    const message = (err as TypeError).message
    throw new InvalidDatasourceError(
      `Error validating \`accelerateUrl\`, the URL cannot be parsed, reason: ${message}`,
      errorInfo,
    )
  }

  const { protocol, searchParams } = url

  if (protocol !== 'prisma:' && protocol !== PRISMA_POSTGRES_PROTOCOL) {
    throw new InvalidDatasourceError(
      `Error validating \`accelerateUrl\`: the URL must start with the protocol \`prisma://\` or \`prisma+postgres://\``,
      errorInfo,
    )
  }

  const apiKey = searchParams.get('api_key')
  if (apiKey === null || apiKey.length < 1) {
    throw new InvalidDatasourceError(
      `Error validating \`accelerateUrl\`: the URL must contain a valid API key`,
      errorInfo,
    )
  }

  // To simplify things, `prisma dev`, for now, will not support HTTPS.
  // In the future, if HTTPS for `prisma dev` becomes a thing, we'll need this line to be dynamic.
  let httpScheme = isPrismaPostgresDev(url) ? 'http:' : 'https:'

  if (process.env.TEST_CLIENT_ENGINE_REMOTE_EXECUTOR && url.searchParams.has('use_http')) {
    httpScheme = 'http:'
  }

  // Switching from `prisma:` or `prisma+postgres:` to `http:` or `https:` by
  // assigning to the `protocol` property is not allowed by the WHATWG URL API,
  // it would be silently ignored without throwing an error. We have to manually
  // update the protocol via string replacement.
  const httpUrl = new URL(url.href.replace(protocol, httpScheme)) as HttpUrl

  return { apiKey, url: httpUrl }
}
