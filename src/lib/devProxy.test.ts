import { describe, expect, it } from 'vitest'
import { buildApiUrl } from './devProxy'
import { createDefaultOpenAIProfile } from './apiProfiles'

describe('buildApiUrl', () => {
  it.each(['images/generations', 'images/edits', 'responses'])(
    'routes the default profile to the versioned 2api %s endpoint',
    (endpoint) => {
      const profile = createDefaultOpenAIProfile()
      expect(buildApiUrl(profile.baseUrl, endpoint, null, false)).toBe(`https://2api.dev/v1/${endpoint}`)
    },
  )

  it('uses the same-origin proxy prefix when API proxy is enabled', () => {
    expect(buildApiUrl('http://api.example.com/v1', 'images/edits', null, true)).toBe(
      '/api-proxy/images/edits',
    )
  })

  it('leaves API versioning to the proxy target when proxying', () => {
    expect(buildApiUrl('http://api.example.com', 'images/generations', null, true)).toBe(
      '/api-proxy/images/generations',
    )
  })

  it('uses a configured proxy prefix when one is available', () => {
    expect(
      buildApiUrl(
        'http://api.example.com/v1',
        'responses',
        {
          enabled: true,
          prefix: '/openai-proxy',
          target: 'http://api.example.com/v1',
          changeOrigin: true,
          secure: false,
        },
        true,
      ),
    ).toBe('/openai-proxy/responses')
  })

  it('lets proxy targets keep their own API version prefix', () => {
    expect(
      buildApiUrl(
        'https://api.example.com/',
        'images/generations',
        {
          enabled: true,
          prefix: '/api-proxy',
          target: 'https://api.example.com/v1',
          changeOrigin: true,
          secure: true,
        },
        true,
      ),
    ).toBe('/api-proxy/images/generations')
  })

  it('uses the configured API URL directly when API proxy is disabled', () => {
    expect(buildApiUrl('http://api.example.com/v1', 'responses', null, false)).toBe(
      'http://api.example.com/v1/responses',
    )
  })
})
