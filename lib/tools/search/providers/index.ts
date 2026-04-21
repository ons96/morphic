import { SearchProvider } from './base'
import { BraveSearchProvider } from './brave'
import { ExaSearchProvider } from './exa'
import { FirecrawlSearchProvider } from './firecrawl'
import { SearXNGSearchProvider } from './searxng'
import { TavilySearchProvider } from './tavily'

export type SearchProviderType =
  | 'tavily'
  | 'exa'
  | 'searxng'
  | 'firecrawl'
  | 'brave'
export const DEFAULT_PROVIDER: SearchProviderType = 'tavily'

export const FREE_TIER_PROVIDER_PRIORITY: SearchProviderType[] = [
  'searxng',
  'tavily',
  'exa',
  'brave',
  'firecrawl'
]

export function hasProviderCredentials(provider: SearchProviderType): boolean {
  switch (provider) {
    case 'searxng':
      return true
    case 'tavily':
      return Boolean(process.env.TAVILY_API_KEY)
    case 'exa':
      return Boolean(process.env.EXA_API_KEY)
    case 'firecrawl':
      return Boolean(process.env.FIRECRAWL_API_KEY)
    case 'brave':
      return Boolean(process.env.BRAVE_SEARCH_API_KEY || process.env.BRAVE_API_KEY)
    default:
      return false
  }
}

export function getProviderFallbackOrder(
  preferred?: SearchProviderType
): SearchProviderType[] {
  const explicit = (process.env.SEARCH_PROVIDER_FALLBACK_ORDER || '')
    .split(',')
    .map(entry => entry.trim() as SearchProviderType)
    .filter(
      (entry): entry is SearchProviderType =>
        FREE_TIER_PROVIDER_PRIORITY.includes(entry)
    )

  const baseOrder =
    explicit.length > 0 ? explicit : [...FREE_TIER_PROVIDER_PRIORITY]

  const chosenPrimary =
    preferred ||
    ((process.env.SEARCH_API as SearchProviderType) ||
      FREE_TIER_PROVIDER_PRIORITY[0])

  const merged = [chosenPrimary, ...baseOrder]
  const uniqueOrdered = Array.from(new Set(merged))

  return uniqueOrdered.filter(hasProviderCredentials)
}

export function createSearchProvider(
  type?: SearchProviderType
): SearchProvider {
  const providerType =
    type || (process.env.SEARCH_API as SearchProviderType) || DEFAULT_PROVIDER

  switch (providerType) {
    case 'tavily':
      return new TavilySearchProvider()
    case 'exa':
      return new ExaSearchProvider()
    case 'searxng':
      return new SearXNGSearchProvider()
    case 'brave':
      return new BraveSearchProvider()
    case 'firecrawl':
      return new FirecrawlSearchProvider()
    default:
      // Default to TavilySearchProvider if an unknown provider is specified
      return new TavilySearchProvider()
  }
}

export { BraveSearchProvider } from './brave'
export type { ExaSearchProvider } from './exa'
export type { FirecrawlSearchProvider } from './firecrawl'
export { SearXNGSearchProvider } from './searxng'
export { TavilySearchProvider } from './tavily'
export type { SearchProvider }
