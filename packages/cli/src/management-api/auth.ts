import events from 'node:events'
import http from 'node:http'
import { AddressInfo } from 'node:net'

import type { ManagementApiSdk } from '@prisma/management-api-sdk'
import { AuthError as SDKAuthError, createManagementApiSdk } from '@prisma/management-api-sdk'
import open from 'open'

import { FileTokenStorage } from './token-storage'

const packageJson = require('../../package.json')

const CLIENT_ID = 'cmi4ttoor03pv2wco4526rnin'

export class AuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuthError'
  }
}

export type LoginOptions = {
  utmMedium: string
}

export async function login(options: LoginOptions): Promise<void> {
  const server = http.createServer()
  server.listen({ host: 'localhost', port: 0 })

  const addressInfo = await events.once(server, 'listening').then(() => server.address() as AddressInfo)
  const state = new LoginState('localhost', addressInfo.port, options.utmMedium)

  const authResult = new Promise<void>((resolve, reject) => {
    server.on('request', async (req, res) => {
      try {
        const url = new URL(`http://${state.host}${req.url}`)
        await state.handleCallback(url)
      } catch (error) {
        res.statusCode = 400
        const message = error instanceof Error ? error.message : String(error)
        res.end(message)
        reject(error)
        return
      }

      res.setHeader('Content-Type', 'text/html')
      res.end(`
        <html>
          <head>
            <title>Login</title>
          </head>
          <body>
            <p>Success!</p>
            <p>You may now close this page.</p>
          </body>
        </html>
      `)

      setImmediate(() => {
        server.close()
      })

      resolve()
    })
  })

  await state.login()
  await authResult
}

export class LoginState {
  private latestVerifier?: string
  private latestState?: string
  private managementAPI: ManagementApiSdk
  private tokenStorage: FileTokenStorage

  constructor(
    private hostname: string,
    private port: number,
    private utmMedium: string,
  ) {
    this.tokenStorage = new FileTokenStorage()
    this.managementAPI = createManagementApiSdk({
      clientId: CLIENT_ID,
      redirectUri: `http://${hostname}:${port}/auth/callback`,
      tokenStorage: this.tokenStorage,
    })
  }

  async login() {
    const { url, state, verifier } = await this.managementAPI.getLoginUrl({
      scope: 'workspace:admin offline_access',
      additionalParams: {
        utm_source: 'cli',
        utm_medium: this.utmMedium,
        utm_campaign: packageJson.version as string,
      },
    })

    this.latestState = state
    this.latestVerifier = verifier

    await open(url)
  }

  async handleCallback(url: URL): Promise<void> {
    if (url.pathname !== '/auth/callback') {
      throw new AuthError('Not a callback')
    }

    const params = url.searchParams

    const error = params.get('error')
    if (error) {
      const errorDescription = params.get('error_description')
      throw new AuthError(errorDescription ? `${error}: ${errorDescription}` : error)
    }

    if (!this.latestVerifier) {
      throw new AuthError('No verifier found')
    }
    if (!this.latestState) {
      throw new AuthError('No state found')
    }

    try {
      await this.managementAPI.handleCallback({
        callbackUrl: url,
        verifier: this.latestVerifier,
        expectedState: this.latestState,
      })
    } catch (error) {
      if (error instanceof SDKAuthError) {
        throw new AuthError(error.message)
      }
      throw new AuthError(error instanceof Error ? error.message : 'Unknown error during login')
    }
  }

  get host(): string {
    return `${this.hostname}:${this.port}`
  }
}
