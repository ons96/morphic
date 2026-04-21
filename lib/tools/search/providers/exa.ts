import { SearchResults } from '@/lib/types'

import { BaseSearchProvider } from './base'

type ExaSearchType = 'keyword' | 'neural' | 'auto' | 'hybrid' | 'fast' | 'deep'
type ExaLivecrawlMode = 'never' | 'fallback' | 'always' | 'auto' | 'preferred'

type ExaSearchApiResult = {
  title?: string
  url?: string
  text?: string
  highlight?: string
  highlights?: string[]
}

type ExaSearchApiResponse = {
  results?: ExaSearchApiResult[]
}

function getExaSearchType(): ExaSearchType {
  const configured = (process.env.EXA_SEARCH_TYPE || 'fast').trim().toLowerCase()
  const allowed: ExaSearchType[] = [
    'keyword',
    'neural',
    'auto',
    'hybrid',
    'fast',
    'deep'
  ]

  if (allowed.includes(configured as ExaSearchType)) {
    return configured as ExaSearchType
  }

  return 'fast'
}

function getExaHighlightsMaxCharacters(): number {
  const parsed = parseInt(process.env.EXA_HIGHLIGHTS_MAX_CHARACTERS || '4000', 10)
  if (Number.isNaN(parsed)) return 4000

  return Math.min(12000, Math.max(200, parsed))
}

function getExaMaxAgeHours(): number | undefined {
  if (!process.env.EXA_MAX_AGE_HOURS) return undefined

  const parsed = parseInt(process.env.EXA_MAX_AGE_HOURS, 10)
  if (Number.isNaN(parsed)) return undefined

  return Math.min(24 * 30, Math.max(-1, parsed))
}

function getExaLivecrawlMode():
  | ExaLivecrawlMode
  | undefined {
  const configured = (process.env.EXA_LIVECRAWL_MODE || '').trim().toLowerCase()
  if (!configured) return undefined

  const allowed = ['never', 'fallback', 'always', 'auto', 'preferred'] as const
  if (allowed.includes(configured as (typeof allowed)[number])) {
    return configured as (typeof allowed)[number]
  }

  return undefined
}

export class ExaSearchProvider extends BaseSearchProvider {
  async search(
    query: string,
    maxResults: number = 10,
    _searchDepth: 'basic' | 'advanced' = 'basic',
    includeDomains: string[] = [],
    excludeDomains: string[] = []
  ): Promise<SearchResults> {
    const apiKey = process.env.EXA_API_KEY
    this.validateApiKey(apiKey, 'EXA')

    try {
      const exaSearchType = getExaSearchType()
      const highlightsMaxCharacters = getExaHighlightsMaxCharacters()
      const maxAgeHours = getExaMaxAgeHours()
      const livecrawlMode = getExaLivecrawlMode()

      const contents: {
        highlights: { maxCharacters: number }
        maxAgeHours?: number
        livecrawl?: ExaLivecrawlMode
      } = {
        highlights: {
          maxCharacters: highlightsMaxCharacters
        },
        ...(typeof maxAgeHours === 'number' ? { maxAgeHours } : {}),
        ...(typeof maxAgeHours !== 'number' && livecrawlMode
          ? { livecrawl: livecrawlMode }
          : {})
      }

      const requestBody: {
        query: string
        type: ExaSearchType
        numResults: number
        includeDomains?: string[]
        excludeDomains?: string[]
        contents: {
          highlights: { maxCharacters: number }
          maxAgeHours?: number
          livecrawl?: ExaLivecrawlMode
        }
      } = {
        query,
        type: exaSearchType,
        numResults: maxResults,
        ...(includeDomains.length > 0 ? { includeDomains } : {}),
        ...(excludeDomains.length > 0 ? { excludeDomains } : {}),
        contents
      }

      const response = await fetch('https://api.exa.ai/search', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw this.createProviderError(
          'Exa',
          `Search failed (${response.status}): ${errorText.slice(0, 240)}`
        )
      }

      const exaResults = (await response.json()) as ExaSearchApiResponse
      if (!Array.isArray(exaResults.results)) {
        throw this.createProviderError('Exa', 'Invalid response structure from Exa')
      }

      return {
        results: exaResults.results.map(result => ({
          title: result.title || '',
          url: result.url || '',
          content:
            (Array.isArray(result.highlights)
              ? result.highlights.join('\n')
              : undefined) ||
            result.highlight ||
            result.text ||
            ''
        })),
        query,
        images: [],
        number_of_results: exaResults.results.length
      }
    } catch (error) {
      throw this.createProviderError(
        'Exa',
        `Search failed: ${error instanceof Error ? error.message : String(error)}`,
        error
      )
    }
  }
}
