import { describe, expect, it, vi } from 'vitest'

import { createApiClient } from '../src/services/apiClient'

describe('api client', () => {
  it('searches by code and returns typed results', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      results: [{ type: 'line', id: 'guid-1', label: 'guid-1', longitude: 120, latitude: 31 }],
    })))

    const api = createApiClient('/api', fetcher)

    await expect(api.search('guid-1')).resolves.toEqual([
      { type: 'line', id: 'guid-1', label: 'guid-1', longitude: 120, latitude: 31 },
    ])
    expect(fetcher).toHaveBeenCalledWith('/api/search?q=guid-1')
  })

  it('encodes search query text for URLs', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ results: [] })))
    const api = createApiClient('/api/', fetcher)

    await api.search('雨水 管/1')

    expect(fetcher).toHaveBeenCalledWith('/api/search?q=%E9%9B%A8%E6%B0%B4%20%E7%AE%A1%2F1')
  })

  it('loads line and point details by encoded identifier', async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url.includes('/lines/')) {
        return new Response(JSON.stringify({ guid: 'line/1', qdbm: 'Q-1', zdbm: 'Z-1' }))
      }

      return new Response(JSON.stringify({ gdbm: 'point/1', lbmc: '检查井' }))
    })
    const api = createApiClient('/api', fetcher)

    await expect(api.getLine('line/1')).resolves.toEqual({ guid: 'line/1', qdbm: 'Q-1', zdbm: 'Z-1' })
    await expect(api.getPoint('point/1')).resolves.toEqual({ gdbm: 'point/1', lbmc: '检查井' })
    expect(fetcher).toHaveBeenNthCalledWith(1, '/api/lines/line%2F1')
    expect(fetcher).toHaveBeenNthCalledWith(2, '/api/points/point%2F1')
  })

  it('loads latest version and quality summaries', async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url.endsWith('/versions/latest')) {
        return new Response(JSON.stringify({
          version: 'v1',
          tilesetUrl: '/tiles/v1/tileset.json',
          metadataUrl: '/tiles/v1/metadata.json',
        }))
      }

      return new Response(JSON.stringify({ version: 'v1', summary: { lineCount: 2 } }))
    })
    const api = createApiClient('/api', fetcher)

    await expect(api.getLatestVersion()).resolves.toEqual({
      version: 'v1',
      tilesetUrl: '/tiles/v1/tileset.json',
      metadataUrl: '/tiles/v1/metadata.json',
    })
    await expect(api.getLatestQuality()).resolves.toEqual({ version: 'v1', summary: { lineCount: 2 } })
    expect(fetcher).toHaveBeenNthCalledWith(1, '/api/versions/latest')
    expect(fetcher).toHaveBeenNthCalledWith(2, '/api/quality/latest')
  })

  it('throws a descriptive error when the API request fails', async () => {
    const fetcher = vi.fn(async () => new Response('missing', { status: 404, statusText: 'Not Found' }))
    const api = createApiClient('/api', fetcher)

    await expect(api.getLine('missing')).rejects.toThrow('GET /api/lines/missing returned 404 Not Found')
  })
})
