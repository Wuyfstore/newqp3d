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

  it('loads datasource discovery data and saves build templates', async () => {
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/datasource/schemas')) {
        return new Response(JSON.stringify({ schemas: [{ name: 'public' }] }))
      }

      if (url.endsWith('/datasource/tables?schema=public')) {
        return new Response(JSON.stringify({
          tables: [{ schema: 'public', name: 'sys_016_tancexbtjinfo_sde', type: 'table', estimatedRows: 10 }],
        }))
      }

      if (url.endsWith('/datasource/tables/public/sys_016_tancexbtjinfo_sde/profile')) {
        return new Response(JSON.stringify({
          schema: 'public',
          table: 'sys_016_tancexbtjinfo_sde',
          estimatedRowCount: 10,
          geometryFields: [{ name: 'geom', srid: 3857, geometryType: 'LINESTRING' }],
          fields: [{ name: 'guid', dataType: 'text', isNullable: false, samples: ['L-1'], nullRate: 0, uniqueCount: 1, recommendedMapping: 'id' }],
          inferredTableKind: 'line',
          recommendedFieldMapping: { id: 'guid' },
        }))
      }

      if (url.endsWith('/build-templates')) {
        return new Response(String(init?.body), { status: 201 })
      }

      throw new Error(`Unexpected URL ${url}`)
    })
    const api = createApiClient('/api', fetcher)

    await expect(api.listSchemas()).resolves.toEqual([{ name: 'public' }])
    await expect(api.listTables('public')).resolves.toEqual([
      { schema: 'public', name: 'sys_016_tancexbtjinfo_sde', type: 'table', estimatedRows: 10 },
    ])
    await expect(api.getTableProfile('public', 'sys_016_tancexbtjinfo_sde')).resolves.toMatchObject({
      recommendedFieldMapping: { id: 'guid' },
    })
    await expect(api.createBuildTemplate({ id: 'template-1', name: '模板' })).resolves.toEqual({
      id: 'template-1',
      name: '模板',
    })

    expect(fetcher).toHaveBeenNthCalledWith(1, '/api/datasource/schemas')
    expect(fetcher).toHaveBeenNthCalledWith(2, '/api/datasource/tables?schema=public')
    expect(fetcher).toHaveBeenNthCalledWith(3, '/api/datasource/tables/public/sys_016_tancexbtjinfo_sde/profile')
    expect(fetcher).toHaveBeenNthCalledWith(4, '/api/build-templates', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'template-1', name: '模板' }),
    })
  })

  it('manages build task lifecycle endpoints', async () => {
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/build-tasks') && init?.method === 'POST') {
        return new Response(JSON.stringify({
          id: 'build-1',
          templateId: 'template-1',
          templateName: '参数化模板',
          templateVersion: '1.0.0',
          status: 'queued',
          progress: 0,
          createdAt: '2026-06-23T00:00:00.000Z',
          updatedAt: '2026-06-23T00:00:00.000Z',
          stagingDir: '/tmp/build-1',
          logs: [],
        }), { status: 201 })
      }

      if (url.endsWith('/build-tasks')) {
        return new Response(JSON.stringify({
          tasks: [{
            id: 'build-1',
            templateId: 'template-1',
            templateName: '参数化模板',
            templateVersion: '1.0.0',
            status: 'tiling',
            progress: 60,
            createdAt: '2026-06-23T00:00:00.000Z',
            updatedAt: '2026-06-23T00:01:00.000Z',
            stagingDir: '/tmp/build-1',
            logs: [],
          }],
        }))
      }

      if (url.endsWith('/build-tasks/build%2F1/cancel')) {
        return new Response(JSON.stringify({
          id: 'build/1',
          templateId: 'template-1',
          templateName: '参数化模板',
          templateVersion: '1.0.0',
          status: 'canceled',
          progress: 60,
          createdAt: '2026-06-23T00:00:00.000Z',
          updatedAt: '2026-06-23T00:01:00.000Z',
          stagingDir: '/tmp/build-1',
          logs: [{ index: 0, timestamp: '2026-06-23T00:01:00.000Z', level: 'warn', message: '取消任务，清理 staging 目录' }],
        }))
      }

      return new Response(JSON.stringify({
        id: 'build/1',
        templateId: 'template-1',
        templateName: '参数化模板',
        templateVersion: '1.0.0',
        status: 'completed',
        progress: 100,
        outputVersion: 'network-g8',
        createdAt: '2026-06-23T00:00:00.000Z',
        updatedAt: '2026-06-23T00:02:00.000Z',
        stagingDir: '/tmp/build-1',
        logs: [{ index: 0, timestamp: '2026-06-23T00:02:00.000Z', level: 'info', message: '瓦片写入完成' }],
      }))
    })
    const api = createApiClient('/api/', fetcher)

    await expect(api.createBuildTask('template-1')).resolves.toMatchObject({
      id: 'build-1',
      status: 'queued',
    })
    await expect(api.listBuildTasks()).resolves.toMatchObject([
      { id: 'build-1', status: 'tiling', progress: 60 },
    ])
    await expect(api.getBuildTask('build/1')).resolves.toMatchObject({
      id: 'build/1',
      status: 'completed',
      outputVersion: 'network-g8',
    })
    await expect(api.cancelBuildTask('build/1')).resolves.toMatchObject({
      id: 'build/1',
      status: 'canceled',
    })

    expect(fetcher).toHaveBeenNthCalledWith(1, '/api/build-tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ templateId: 'template-1' }),
    })
    expect(fetcher).toHaveBeenNthCalledWith(2, '/api/build-tasks')
    expect(fetcher).toHaveBeenNthCalledWith(3, '/api/build-tasks/build%2F1')
    expect(fetcher).toHaveBeenNthCalledWith(4, '/api/build-tasks/build%2F1/cancel', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
  })

  it('throws a descriptive error when the API request fails', async () => {
    const fetcher = vi.fn(async () => new Response('missing', { status: 404, statusText: 'Not Found' }))
    const api = createApiClient('/api', fetcher)

    await expect(api.getLine('missing')).rejects.toThrow('GET /api/lines/missing returned 404 Not Found')
  })
})
