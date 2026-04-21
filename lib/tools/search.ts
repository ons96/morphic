import { tool, UIToolInvocation } from 'ai'

import { getSearchSchemaForModel } from '@/lib/schema/search'
import { SearchResultItem, SearchResults } from '@/lib/types'
import {
  getGeneralSearchProviderType,
  getSearchToolDescription
} from '@/lib/utils/search-config'
import { getBaseUrlString } from '@/lib/utils/url'

import {
  createSearchProvider,
  DEFAULT_PROVIDER,
  getProviderFallbackOrder,
  SearchProviderType
} from './search/providers'

function getMinimumResultsForProviderSuccess(): number {
  const parsed = parseInt(process.env.SEARCH_PROVIDER_MIN_RESULTS_FOR_SUCCESS || '1', 10)
  if (Number.isNaN(parsed)) return 1

  return Math.min(20, Math.max(0, parsed))
}

function hasUsableResults(
  searchResult: SearchResults | null,
  minResultsForSuccess: number
): boolean {
  if (!searchResult) {
    return false
  }

  const resultCount = Array.isArray(searchResult.results)
    ? searchResult.results.length
    : 0
  const imageCount = Array.isArray(searchResult.images)
    ? searchResult.images.length
    : 0
  const videoCount = Array.isArray(searchResult.videos)
    ? searchResult.videos.length
    : 0

  if (resultCount >= minResultsForSuccess) {
    return true
  }

  if (resultCount > 0 || imageCount > 0 || videoCount > 0) {
    return true
  }

  return minResultsForSuccess === 0
}

/**
 * Creates a search tool with the appropriate schema for the given model.
 */
export function createSearchTool(fullModel: string) {
  return tool({
    description: getSearchToolDescription(),
    inputSchema: getSearchSchemaForModel(fullModel),
    async *execute(
      {
        query,
        type = 'optimized',
        content_types = ['web'],
        max_results = 20,
        search_depth = 'basic', // Default for standard schema
        include_domains = [],
        exclude_domains = []
      },
      context
    ) {
      // Yield initial searching state
      yield {
        state: 'searching' as const,
        query
      }
      // Ensure max_results is at least 10
      const minResults = 10
      const effectiveMaxResults = Math.max(
        max_results || minResults,
        minResults
      )
      const effectiveSearchDepth = search_depth as 'basic' | 'advanced'

      // Use the original query as is - any provider-specific handling will be done in the provider
      const filledQuery = query
      let searchResult: SearchResults | null = null

      let preferredProvider: SearchProviderType
      if (type === 'general') {
        const generalProvider = getGeneralSearchProviderType()
        if (generalProvider) {
          preferredProvider = generalProvider
        } else {
          preferredProvider =
            (process.env.SEARCH_API as SearchProviderType) || DEFAULT_PROVIDER
          console.log(
            `[Search] type="general" requested but no dedicated provider available, using optimized search provider: ${preferredProvider}`
          )
        }
      } else {
        preferredProvider =
          (process.env.SEARCH_API as SearchProviderType) || DEFAULT_PROVIDER
      }

      const providerOrder = getProviderFallbackOrder(preferredProvider)
      if (providerOrder.length === 0) {
        throw new Error('No search providers are configured with valid credentials')
      }

      const minResultsForSuccess = getMinimumResultsForProviderSuccess()
      const providerErrors: string[] = []

      console.log(
        `[Search] type=${type} preferred=${preferredProvider} providers=${providerOrder.join(' -> ')}`
      )

      try {
        for (const provider of providerOrder) {
          const effectiveSearchDepthForProvider =
            provider === 'searxng' && process.env.SEARXNG_DEFAULT_DEPTH === 'advanced'
              ? 'advanced'
              : effectiveSearchDepth || 'basic'

          console.log(
            `[Search] trying provider=${provider} depth=${effectiveSearchDepthForProvider}`
          )

          try {
            if (
              provider === 'searxng' &&
              effectiveSearchDepthForProvider === 'advanced'
            ) {
              const baseUrl = await getBaseUrlString()

              const response = await fetch(`${baseUrl}/api/advanced-search`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  query: filledQuery,
                  maxResults: effectiveMaxResults,
                  searchDepth: effectiveSearchDepthForProvider,
                  includeDomains: include_domains,
                  excludeDomains: exclude_domains
                })
              })
              if (!response.ok) {
                throw new Error(
                  `Advanced search API error: ${response.status} ${response.statusText}`
                )
              }
              searchResult = await response.json()
            } else {
              const searchProvider = createSearchProvider(provider)

              if (provider === 'brave') {
                searchResult = await searchProvider.search(
                  filledQuery,
                  effectiveMaxResults,
                  effectiveSearchDepthForProvider,
                  include_domains,
                  exclude_domains,
                  {
                    type: type as 'general' | 'optimized',
                    content_types: content_types as Array<
                      'web' | 'video' | 'image' | 'news'
                    >
                  }
                )
              } else {
                searchResult = await searchProvider.search(
                  filledQuery,
                  effectiveMaxResults,
                  effectiveSearchDepthForProvider,
                  include_domains,
                  exclude_domains
                )
              }
            }

            if (!hasUsableResults(searchResult, minResultsForSuccess)) {
              providerErrors.push(`[${provider}] empty or unusable results`)
              continue
            }

            break
          } catch (providerError) {
            const message =
              providerError instanceof Error
                ? providerError.message
                : String(providerError)
            providerErrors.push(`[${provider}] ${message}`)
            continue
          }
        }

        if (!searchResult || !hasUsableResults(searchResult, minResultsForSuccess)) {
          throw new Error(
            `All search providers failed or returned no usable results: ${providerErrors.join(' | ')}`
          )
        }
      } catch (error) {
        console.error('Search API error:', error)
        throw error instanceof Error ? error : new Error('Unknown search error')
      }

      // Add citation mapping and toolCallId to search results
      if (searchResult?.results && searchResult.results.length > 0) {
        const citationMap: Record<number, SearchResultItem> = {}
        searchResult.results.forEach((result, index) => {
          citationMap[index + 1] = result // Citation numbers start at 1
        })
        searchResult.citationMap = citationMap
      }

      // Add toolCallId from context
      if (context?.toolCallId && searchResult) {
        searchResult.toolCallId = context.toolCallId
      }

      console.log('completed search')

      // Yield final results with complete state
      yield {
        state: 'complete' as const,
        ...(searchResult || {
          results: [],
          images: [],
          query: filledQuery,
          number_of_results: 0
        })
      }
    }
  })
}

// Default export for backward compatibility, using a default model
export const searchTool = createSearchTool('openai:gpt-4o-mini')

// Export type for UI tool invocation
export type SearchUIToolInvocation = UIToolInvocation<typeof searchTool>

export async function search(
  query: string,
  maxResults: number = 10,
  searchDepth: 'basic' | 'advanced' = 'basic',
  includeDomains: string[] = [],
  excludeDomains: string[] = []
): Promise<SearchResults> {
  const result = await searchTool.execute?.(
    {
      query,
      type: 'general',
      content_types: ['web'],
      max_results: maxResults,
      search_depth: searchDepth,
      include_domains: includeDomains,
      exclude_domains: excludeDomains
    },
    {
      toolCallId: 'search',
      messages: []
    }
  )

  if (!result) {
    return { results: [], images: [], query, number_of_results: 0 }
  }

  // Handle AsyncIterable case
  if (Symbol.asyncIterator in result) {
    // Collect all results from the async iterable
    let searchResults: SearchResults | null = null
    for await (const chunk of result) {
      // Only assign when we get the complete result
      if ('state' in chunk && chunk.state === 'complete') {
        const { state, ...rest } = chunk
        searchResults = rest as SearchResults
      }
    }
    return (
      searchResults ?? { results: [], images: [], query, number_of_results: 0 }
    )
  }

  return result as SearchResults
}
