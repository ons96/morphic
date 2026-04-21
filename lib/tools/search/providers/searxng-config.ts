const DEFAULT_SEARXNG_INSTANCES = [
  'https://searx.tiekoetter.com',
  'https://paulgo.io',
  'https://search.hbubli.cc',
  'https://search.inetol.net',
  'https://priv.au',
  'https://search.ononoki.org',
  'https://search.mdosch.de',
  'https://search.rowie.at',
  'https://search.im-in.space',
  'https://search.bladerunn.in',
  'https://search.sapti.me',
  'https://search.seddens.net',
  'https://search.freestater.org'
]

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

function parseCsvUrls(value: string | undefined): string[] {
  if (!value) return []

  return value
    .split(',')
    .map(normalizeBaseUrl)
    .filter(Boolean)
}

export function getSearXNGFallbackUrls(): string[] {
  const explicitList = parseCsvUrls(process.env.SEARXNG_API_URLS)

  if (explicitList.length > 0) {
    return Array.from(new Set(explicitList))
  }

  const singleUrl = normalizeBaseUrl(process.env.SEARXNG_API_URL || '')
  const configured = singleUrl ? [singleUrl] : []

  return Array.from(new Set([...configured, ...DEFAULT_SEARXNG_INSTANCES]))
}

export function getSearXNGRequestTimeoutMs(): number {
  const parsed = parseInt(process.env.SEARXNG_REQUEST_TIMEOUT_MS || '10000', 10)
  if (Number.isNaN(parsed)) return 10000

  return Math.min(30000, Math.max(1000, parsed))
}

export function getSearXNGTimeoutRescueStepMs(): number {
  const parsed = parseInt(
    process.env.SEARXNG_TIMEOUT_RESCUE_STEP_MS || '3000',
    10
  )

  if (Number.isNaN(parsed)) return 3000
  return Math.min(15000, Math.max(500, parsed))
}

export function getSearXNGMaxRescueTimeoutMs(): number {
  const parsed = parseInt(
    process.env.SEARXNG_MAX_RESCUE_TIMEOUT_MS || '60000',
    10
  )

  if (Number.isNaN(parsed)) return 60000
  return Math.min(120000, Math.max(5000, parsed))
}
