import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest'

import {
  getSearXNGFallbackUrls,
  getSearXNGMaxRescueTimeoutMs,
  getSearXNGRequestTimeoutMs,
  getSearXNGTimeoutRescueStepMs
} from '../searxng-config'
import {
  getAdaptiveSearXNGTimeoutMs,
  increaseAdaptiveSearXNGTimeout,
  markSearXNGInstanceFailure,
  markSearXNGInstanceSuccess,
  orderSearXNGInstances,
  reduceAdaptiveSearXNGTimeout
} from '../searxng-health'

const ORIGINAL_ENV = { ...process.env }

describe('searxng fallback configuration', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV }
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
    vi.useRealTimers()
  })

  it('uses SEARXNG_API_URLS as strict ordered list', () => {
    process.env.SEARXNG_API_URLS =
      ' https://a.example/ ,https://b.example,https://a.example '
    process.env.SEARXNG_API_URL = 'https://ignored.example'

    expect(getSearXNGFallbackUrls()).toEqual([
      'https://a.example',
      'https://b.example'
    ])
  })

  it('falls back to SEARXNG_API_URL then defaults when list is absent', () => {
    delete process.env.SEARXNG_API_URLS
    process.env.SEARXNG_API_URL = 'https://primary.example/'

    const urls = getSearXNGFallbackUrls()
    expect(urls[0]).toBe('https://primary.example')
    expect(urls).toContain('https://priv.au')
    expect(urls).toContain('https://searx.tiekoetter.com')
  })

  it('clamps request timeout to expected range', () => {
    process.env.SEARXNG_REQUEST_TIMEOUT_MS = '100'
    expect(getSearXNGRequestTimeoutMs()).toBe(1000)

    process.env.SEARXNG_REQUEST_TIMEOUT_MS = '60000'
    expect(getSearXNGRequestTimeoutMs()).toBe(30000)

    process.env.SEARXNG_REQUEST_TIMEOUT_MS = '12000'
    expect(getSearXNGRequestTimeoutMs()).toBe(12000)
  })

  it('clamps timeout rescue tuning values to expected ranges', () => {
    process.env.SEARXNG_TIMEOUT_RESCUE_STEP_MS = '10'
    expect(getSearXNGTimeoutRescueStepMs()).toBe(500)

    process.env.SEARXNG_TIMEOUT_RESCUE_STEP_MS = '30000'
    expect(getSearXNGTimeoutRescueStepMs()).toBe(15000)

    process.env.SEARXNG_MAX_RESCUE_TIMEOUT_MS = '1000'
    expect(getSearXNGMaxRescueTimeoutMs()).toBe(5000)

    process.env.SEARXNG_MAX_RESCUE_TIMEOUT_MS = '200000'
    expect(getSearXNGMaxRescueTimeoutMs()).toBe(120000)
  })

  it('pushes unhealthy instances to the back while preserving order', () => {
    process.env.SEARXNG_FAILURE_COOLDOWN_MS = '120000'
    const urls = ['https://a.example', 'https://b.example', 'https://c.example']

    markSearXNGInstanceFailure('https://b.example')
    expect(orderSearXNGInstances(urls)).toEqual([
      'https://a.example',
      'https://c.example',
      'https://b.example'
    ])

    markSearXNGInstanceSuccess('https://b.example')
    expect(orderSearXNGInstances(urls)).toEqual(urls)
  })

  it('keeps original order when every instance is unhealthy', () => {
    process.env.SEARXNG_FAILURE_COOLDOWN_MS = '120000'
    const urls = ['https://a.example', 'https://b.example']

    markSearXNGInstanceFailure('https://a.example')
    markSearXNGInstanceFailure('https://b.example')

    expect(orderSearXNGInstances(urls)).toEqual(urls)
  })

  it('increases and reduces adaptive timeout per instance', () => {
    const url = 'https://a.example'
    const baseTimeout = 10000

    expect(getAdaptiveSearXNGTimeoutMs(url, baseTimeout)).toBe(baseTimeout)

    const raised = increaseAdaptiveSearXNGTimeout(url, baseTimeout, 3000, 60000)
    expect(raised).toBe(13000)
    expect(getAdaptiveSearXNGTimeoutMs(url, baseTimeout)).toBe(13000)

    reduceAdaptiveSearXNGTimeout(url, 2000, baseTimeout)
    expect(getAdaptiveSearXNGTimeoutMs(url, baseTimeout)).toBe(11500)

    reduceAdaptiveSearXNGTimeout(url, 500, baseTimeout)
    expect(getAdaptiveSearXNGTimeoutMs(url, baseTimeout)).toBe(10750)
  })
})
