import {
  SearchResultItem,
  SearchResults,
  SearXNGResponse,
  SearXNGResult
} from '@/lib/types'

import { BaseSearchProvider } from './base'
import {
  getSearXNGFallbackUrls,
  getSearXNGMaxRescueTimeoutMs,
  getSearXNGRequestTimeoutMs,
  getSearXNGTimeoutRescueStepMs
} from './searxng-config'
import {
  getAdaptiveSearXNGTimeoutMs,
  increaseAdaptiveSearXNGTimeout,
  markSearXNGInstanceFailure,
  markSearXNGInstanceSuccess,
  orderSearXNGInstances,
  reduceAdaptiveSearXNGTimeout
} from './searxng-health'

export class SearXNGSearchProvider extends BaseSearchProvider {
  private buildSearchUrl(
    apiUrl: string,
    query: string,
    searchDepth: 'basic' | 'advanced',
    includeDomains: string[]
  ): URL {
    const url = new URL(`${apiUrl}/search`)
    url.searchParams.append('q', query)
    url.searchParams.append('format', 'json')
    url.searchParams.append('categories', 'general,images')

    if (searchDepth === 'advanced') {
      url.searchParams.append('time_range', '')
      url.searchParams.append('safesearch', '0')
      url.searchParams.append('engines', 'google,bing,duckduckgo,wikipedia')
    } else {
      url.searchParams.append('time_range', 'year')
      url.searchParams.append('safesearch', '1')
      url.searchParams.append('engines', 'google,bing')
    }

    if (includeDomains.length > 0) {
      url.searchParams.append('site', includeDomains.join(','))
    }

    return url
  }

  private isDomainAllowed(
    resultUrl: string,
    includeDomains: string[],
    excludeDomains: string[]
  ): boolean {
    if (includeDomains.length === 0 && excludeDomains.length === 0) {
      return true
    }

    try {
      const domain = new URL(resultUrl).hostname

      const includeMatch =
        includeDomains.length === 0 ||
        includeDomains.some(includeDomain => domain.includes(includeDomain))

      const excludeMatch = excludeDomains.some(excludeDomain =>
        domain.includes(excludeDomain)
      )

      return includeMatch && !excludeMatch
    } catch {
      return includeDomains.length === 0
    }
  }

  private async fetchSearXNGResponse(
    url: string,
    timeoutMs: number
  ): Promise<SearXNGResponse> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json'
        },
        signal: controller.signal
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(
          `SearXNG request failed (${response.status}): ${errorText.substring(0, 200)}`
        )
      }

      const data: SearXNGResponse = await response.json()

      if (!data || !Array.isArray(data.results)) {
        throw new Error('Invalid SearXNG response structure')
      }

      return data
    } finally {
      clearTimeout(timeoutId)
    }
  }

  private async fetchWithTimeoutRescue(
    apiUrl: string,
    requestUrl: string
  ): Promise<{ data: SearXNGResponse; durationMs: number }> {
    const baseTimeoutMs = getSearXNGRequestTimeoutMs()
    const rescueStepMs = getSearXNGTimeoutRescueStepMs()
    const maxRescueTimeoutMs = getSearXNGMaxRescueTimeoutMs()

    let timeoutMs = getAdaptiveSearXNGTimeoutMs(apiUrl, baseTimeoutMs)
    let lastError: Error | null = null

    while (timeoutMs <= maxRescueTimeoutMs) {
      const start = Date.now()

      try {
        const data = await this.fetchSearXNGResponse(requestUrl, timeoutMs)
        const durationMs = Date.now() - start

        reduceAdaptiveSearXNGTimeout(apiUrl, durationMs, baseTimeoutMs)
        return { data, durationMs }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const isAbort =
          error instanceof Error &&
          (error.name === 'AbortError' || message.toLowerCase().includes('abort'))

        lastError = error instanceof Error ? error : new Error(message)

        if (!isAbort) {
          throw lastError
        }

        if (timeoutMs >= maxRescueTimeoutMs) {
          break
        }

        timeoutMs = increaseAdaptiveSearXNGTimeout(
          apiUrl,
          timeoutMs,
          rescueStepMs,
          maxRescueTimeoutMs
        )
      }
    }

    throw lastError || new Error('SearXNG timeout rescue failed')
  }

  async search(
    query: string,
    maxResults: number = 10,
    searchDepth: 'basic' | 'advanced' = 'basic',
    includeDomains: string[] = [],
    excludeDomains: string[] = []
  ): Promise<SearchResults> {
    const configuredUrls = getSearXNGFallbackUrls()
    if (configuredUrls.length === 0) {
      throw new Error('SEARXNG_API_URL or SEARXNG_API_URLS must be configured')
    }

    const orderedUrls = orderSearXNGInstances(configuredUrls)
    const errors: string[] = []

    for (const apiUrl of orderedUrls) {
      try {
        const url = this.buildSearchUrl(apiUrl, query, searchDepth, includeDomains)
        const { data } = await this.fetchWithTimeoutRescue(
          apiUrl,
          url.toString()
        )

        markSearXNGInstanceSuccess(apiUrl)

        const generalResults = data.results
          .filter(result => result && !result.img_src)
          .filter(result =>
            this.isDomainAllowed(result.url, includeDomains, excludeDomains)
          )
          .slice(0, maxResults)

        const imageResults = data.results
          .filter(result => result && result.img_src)
          .slice(0, maxResults)

        return {
          results: generalResults.map(
            (result: SearXNGResult): SearchResultItem => ({
              title: result.title || '',
              url: result.url || '',
              content: result.content || ''
            })
          ),
          query: data.query || query,
          images: imageResults
            .map(result => {
              const imgSrc = result.img_src || ''
              return imgSrc.startsWith('http') ? imgSrc : `${apiUrl}${imgSrc}`
            })
            .filter(Boolean),
          number_of_results: data.number_of_results
        }
      } catch (error) {
        markSearXNGInstanceFailure(apiUrl)
        const message = error instanceof Error ? error.message : String(error)
        errors.push(`[${apiUrl}] ${message}`)
        continue
      }
    }

    throw new Error(`All SearXNG instances failed: ${errors.join(' | ')}`)
  }
}
