import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  getProviderFallbackOrder,
  hasProviderCredentials
} from '../index'

const ORIGINAL_ENV = { ...process.env }

describe('search provider fallback order', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  it('always includes searxng even without API keys', () => {
    delete process.env.TAVILY_API_KEY
    delete process.env.EXA_API_KEY
    delete process.env.FIRECRAWL_API_KEY
    delete process.env.BRAVE_SEARCH_API_KEY
    delete process.env.BRAVE_API_KEY

    expect(hasProviderCredentials('searxng')).toBe(true)
    expect(getProviderFallbackOrder('searxng')).toEqual(['searxng'])
  })

  it('filters providers without keys and preserves configured order', () => {
    process.env.SEARCH_PROVIDER_FALLBACK_ORDER =
      'tavily,exa,searxng,firecrawl,brave'
    process.env.TAVILY_API_KEY = 't-key'
    process.env.BRAVE_API_KEY = 'b-key'

    expect(getProviderFallbackOrder('searxng')).toEqual([
      'searxng',
      'tavily',
      'brave'
    ])
  })

  it('accepts BRAVE_API_KEY alias for brave provider', () => {
    delete process.env.BRAVE_SEARCH_API_KEY
    process.env.BRAVE_API_KEY = 'b-key'

    expect(hasProviderCredentials('brave')).toBe(true)
    expect(getProviderFallbackOrder('brave')).toContain('brave')
  })
})
