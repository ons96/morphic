const instanceFailureUntil = new Map<string, number>()
const adaptiveTimeoutByInstance = new Map<string, number>()

function getFailureCooldownMs(): number {
  const parsed = parseInt(process.env.SEARXNG_FAILURE_COOLDOWN_MS || '60000', 10)
  if (Number.isNaN(parsed)) return 60000

  return Math.min(300000, Math.max(5000, parsed))
}

function isTemporarilyUnhealthy(url: string, now: number): boolean {
  const retryAt = instanceFailureUntil.get(url)
  return typeof retryAt === 'number' && retryAt > now
}

export function orderSearXNGInstances(urls: string[]): string[] {
  const now = Date.now()
  const healthy: string[] = []
  const unhealthy: string[] = []

  for (const url of urls) {
    if (isTemporarilyUnhealthy(url, now)) {
      unhealthy.push(url)
    } else {
      healthy.push(url)
    }
  }

  if (healthy.length === 0) {
    return [...urls]
  }

  return [...healthy, ...unhealthy]
}

export function markSearXNGInstanceFailure(url: string): void {
  instanceFailureUntil.set(url, Date.now() + getFailureCooldownMs())
}

export function markSearXNGInstanceSuccess(url: string): void {
  instanceFailureUntil.delete(url)
}

export function getAdaptiveSearXNGTimeoutMs(
  url: string,
  baseTimeoutMs: number
): number {
  const adaptive = adaptiveTimeoutByInstance.get(url)
  if (typeof adaptive === 'number' && adaptive > baseTimeoutMs) {
    return adaptive
  }

  return baseTimeoutMs
}

export function increaseAdaptiveSearXNGTimeout(
  url: string,
  currentTimeoutMs: number,
  stepMs: number,
  maxTimeoutMs: number
): number {
  const next = Math.min(maxTimeoutMs, currentTimeoutMs + stepMs)
  adaptiveTimeoutByInstance.set(url, next)
  return next
}

export function reduceAdaptiveSearXNGTimeout(
  url: string,
  measuredDurationMs: number,
  baseTimeoutMs: number
): void {
  const boundedDuration = Math.max(baseTimeoutMs, measuredDurationMs + 750)
  const current = adaptiveTimeoutByInstance.get(url)

  if (typeof current !== 'number') {
    if (boundedDuration > baseTimeoutMs) {
      adaptiveTimeoutByInstance.set(url, boundedDuration)
    }
    return
  }

  if (boundedDuration >= current) {
    return
  }

  const softened = Math.max(baseTimeoutMs, Math.floor((current + boundedDuration) / 2))
  if (softened === baseTimeoutMs) {
    adaptiveTimeoutByInstance.delete(url)
  } else {
    adaptiveTimeoutByInstance.set(url, softened)
  }
}
