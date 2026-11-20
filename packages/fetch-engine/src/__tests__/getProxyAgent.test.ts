import { afterAll, beforeEach, describe, expect, test, vi } from 'vitest'

import { getProxyAgent } from '../getProxyAgent'

describe('getProxyAgent', () => {
  const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
  })

  afterAll(() => {
    vi.resetAllMocks()
    vi.unstubAllEnvs()
  })

  test('no proxy / env vars are set - HTTP', () => {
    expect(getProxyAgent('http://example.com')).toBeUndefined()
    expect(consoleSpy.mock.calls.join('\n')).toBe('')
  })
  test('no proxy / env vars are set - HTTPS', () => {
    expect(getProxyAgent('https://example.com')).toBeUndefined()
    expect(consoleSpy.mock.calls.join('\n')).toBe('')
  })

  test('should not use a proxy with NO_PROXY & HTTPS_PROXY set - HTTPS', () => {
    vi.stubEnv('NO_PROXY', 'example.com')
    vi.stubEnv('HTTPS_PROXY', 'proxy.example.com')
    expect(getProxyAgent('https://example.com')).toBeUndefined()
    expect(consoleSpy.mock.calls.join('\n')).toBe('')
  })

  // Lowercase env vars
  test('should warn when http_proxy is not a valid URL - HTTP', () => {
    vi.stubEnv('http_proxy', 'proxy.example.com')
    expect(getProxyAgent('http://example.com')).toBeUndefined()
    expect(consoleSpy.mock.calls[0][0]).toMatchInlineSnapshot(
      `"An error occurred in getProxyAgent(), no proxy agent will be used."`,
    )
    expect(consoleSpy.mock.calls[0][1].message.replace(' [ERR_INVALID_URL]', '')).toMatchInlineSnapshot(`
      "Error while instantiating HttpProxyAgent with URL: "proxy.example.com"
      TypeError: Invalid URL
      Check the following env vars "http_proxy" or "HTTP_PROXY". The value should be a valid URL starting with "http://""
    `)
    expect(consoleSpy.mock.calls[0].length).toBe(2)
  })
  test('should warn when https_proxy is not a valid URL - HTTPS', () => {
    vi.stubEnv('https_proxy', 'proxy.example.com')
    expect(getProxyAgent('https://example.com')).toBeUndefined()
    expect(consoleSpy.mock.calls[0][0]).toMatchInlineSnapshot(
      `"An error occurred in getProxyAgent(), no proxy agent will be used."`,
    )
    expect(consoleSpy.mock.calls[0][1].message.replace(' [ERR_INVALID_URL]', '')).toMatchInlineSnapshot(`
      "Error while instantiating HttpsProxyAgent with URL: "proxy.example.com"
      TypeError: Invalid URL
      Check the following env vars "https_proxy" or "HTTPS_PROXY". The value should be a valid URL starting with "https://""
    `)
    expect(consoleSpy.mock.calls[0].length).toBe(2)
  })
  // Uppercase env vars
  test('should warn when HTTP_PROXY is not a valid URL - HTTP', () => {
    vi.stubEnv('HTTP_PROXY', 'proxy.example.com')
    expect(getProxyAgent('http://example.com')).toBeUndefined()
    expect(consoleSpy.mock.calls[0][0]).toMatchInlineSnapshot(
      `"An error occurred in getProxyAgent(), no proxy agent will be used."`,
    )
    expect(consoleSpy.mock.calls[0][1].message.replace(' [ERR_INVALID_URL]', '')).toMatchInlineSnapshot(`
      "Error while instantiating HttpProxyAgent with URL: "proxy.example.com"
      TypeError: Invalid URL
      Check the following env vars "http_proxy" or "HTTP_PROXY". The value should be a valid URL starting with "http://""
    `)
    expect(consoleSpy.mock.calls[0].length).toBe(2)
  })
  test('should warn when HTTPS_PROXY is not a valid URL - HTTPS', () => {
    vi.stubEnv('HTTPS_PROXY', 'proxy.example.com')
    expect(getProxyAgent('https://example.com')).toBeUndefined()
    expect(consoleSpy.mock.calls[0][0]).toMatchInlineSnapshot(
      `"An error occurred in getProxyAgent(), no proxy agent will be used."`,
    )
    expect(consoleSpy.mock.calls[0][1].message.replace(' [ERR_INVALID_URL]', '')).toMatchInlineSnapshot(`
      "Error while instantiating HttpsProxyAgent with URL: "proxy.example.com"
      TypeError: Invalid URL
      Check the following env vars "https_proxy" or "HTTPS_PROXY". The value should be a valid URL starting with "https://""
    `)
    expect(consoleSpy.mock.calls[0].length).toBe(2)
  })

  // Lowercase env vars
  test('should use a proxy with http_proxy set - HTTP', () => {
    vi.stubEnv('http_proxy', 'http://proxy.example.com')
    expect(getProxyAgent('http://example.com')?.proxy.toString()).toEqual('http://proxy.example.com/')
    expect(consoleSpy.mock.calls.join('\n')).toBe('')
  })
  test('should use a proxy with https_proxy set - HTTPS', () => {
    vi.stubEnv('https_proxy', 'https://proxy.example.com')
    expect(getProxyAgent('https://example.com')?.proxy.toString()).toEqual('https://proxy.example.com/')
    expect(consoleSpy.mock.calls.join('\n')).toBe('')
  })
  // Uppercase env vars
  test('should use a proxy with HTTP_PROX set - HTTP', () => {
    vi.stubEnv('HTTP_PROXY', 'http://proxy.example.com')
    expect(getProxyAgent('http://example.com')?.proxy.toString()).toEqual('http://proxy.example.com/')
    expect(consoleSpy.mock.calls.join('\n')).toBe('')
  })
  test('should use a proxy with HTTPS_PROXY set - HTTPS', () => {
    vi.stubEnv('HTTPS_PROXY', 'https://proxy.example.com')
    expect(getProxyAgent('https://example.com')?.proxy.toString()).toEqual('https://proxy.example.com/')
    expect(consoleSpy.mock.calls.join('\n')).toBe('')
  })
})
