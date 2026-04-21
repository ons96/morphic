import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ExaSearchProvider } from '../exa'

const ORIGINAL_ENV = { ...process.env }

type FetchCall = [input: RequestInfo | URL, init?: RequestInit]

const fetchMock = vi.fn(async () => ({
  ok: true,
  status: 200,
  json: async () => ({
    results: [
      {
        title: 'Example',
        url: 'https://example.com',
        highlights: ['h1', 'h2']
      }
    ]
  }),
  text: async () => ''
}))

describe('Exa provider env-driven config', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV }
    process.env.EXA_API_KEY = 'exa-test-key'
    fetchMock.mockClear()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
    vi.unstubAllGlobals()
  })

  it('uses fast + compact defaults when env vars are absent', async () => {
    delete process.env.EXA_SEARCH_TYPE
    delete process.env.EXA_HIGHLIGHTS_MAX_CHARACTERS
    delete process.env.EXA_MAX_AGE_HOURS
    delete process.env.EXA_LIVECRAWL_MODE

    const provider = new ExaSearchProvider()
    await provider.search('hello world', 10)

    expect(fetchMock).toHaveBeenCalledOnce()
    const call = fetchMock.mock.calls[0] as unknown as FetchCall | undefined
    expect(call).toBeDefined()
    const init = call ? call[1] : undefined
    expect(init).toBeDefined()

    const requestInit = init as unknown as RequestInit
    const body = JSON.parse((requestInit.body as string) || '{}')

    expect(body.type).toBe('fast')
    expect(body.contents.highlights).toEqual({ maxCharacters: 4000 })
    expect(body.contents.maxAgeHours).toBeUndefined()
    expect(body.contents.livecrawl).toBeUndefined()
  })

  it('applies env overrides with clamping and validation', async () => {
    process.env.EXA_SEARCH_TYPE = 'auto'
    process.env.EXA_HIGHLIGHTS_MAX_CHARACTERS = '999999'
    process.env.EXA_MAX_AGE_HOURS = '-5'
    process.env.EXA_LIVECRAWL_MODE = 'preferred'

    const provider = new ExaSearchProvider()
    await provider.search('hello world', 7)

    const call = fetchMock.mock.calls[0] as unknown as FetchCall | undefined
    expect(call).toBeDefined()
    const init = call ? call[1] : undefined
    expect(init).toBeDefined()

    const requestInit = init as unknown as RequestInit
    const body = JSON.parse((requestInit.body as string) || '{}')

    expect(body.type).toBe('auto')
    expect(body.contents.highlights).toEqual({ maxCharacters: 12000 })
    expect(body.contents.maxAgeHours).toBe(-1)
    expect(body.contents.livecrawl).toBeUndefined()
    expect(body.numResults).toBe(7)
  })

  it('falls back to safe defaults for invalid env values', async () => {
    process.env.EXA_SEARCH_TYPE = 'banana'
    process.env.EXA_HIGHLIGHTS_MAX_CHARACTERS = 'bad'
    process.env.EXA_MAX_AGE_HOURS = 'oops'
    process.env.EXA_LIVECRAWL_MODE = 'invalid-mode'

    const provider = new ExaSearchProvider()
    await provider.search('fallback test', 5)

    const call = fetchMock.mock.calls[0] as unknown as FetchCall | undefined
    expect(call).toBeDefined()
    const init = call ? call[1] : undefined
    expect(init).toBeDefined()

    const requestInit = init as unknown as RequestInit
    const body = JSON.parse((requestInit.body as string) || '{}')

    expect(body.type).toBe('fast')
    expect(body.contents.highlights).toEqual({ maxCharacters: 4000 })
    expect(body.contents.maxAgeHours).toBeUndefined()
    expect(body.contents.livecrawl).toBeUndefined()
  })

  it('uses livecrawl mode only when maxAgeHours is not set', async () => {
    process.env.EXA_SEARCH_TYPE = 'fast'
    process.env.EXA_LIVECRAWL_MODE = 'preferred'
    delete process.env.EXA_MAX_AGE_HOURS

    const provider = new ExaSearchProvider()
    await provider.search('livecrawl mode test', 6)

    const call = fetchMock.mock.calls[0] as unknown as FetchCall | undefined
    expect(call).toBeDefined()
    const init = call ? call[1] : undefined
    expect(init).toBeDefined()

    const requestInit = init as unknown as RequestInit
    const body = JSON.parse((requestInit.body as string) || '{}')
    expect(body.contents.livecrawl).toBe('preferred')
    expect(body.contents.maxAgeHours).toBeUndefined()
  })
})
