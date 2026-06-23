import { describe, expect, it, vi } from 'vitest'

import { createReferenceBuildTemplate } from '@new-qp3d/shared'
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
    await expect(api.getVersion('network/preview')).resolves.toEqual({ version: 'v1', summary: { lineCount: 2 } })
    await expect(api.getLatestQuality()).resolves.toEqual({ version: 'v1', summary: { lineCount: 2 } })
    await expect(api.getQualityReport('v1')).resolves.toEqual({ version: 'v1', summary: { lineCount: 2 } })
    expect(fetcher).toHaveBeenNthCalledWith(1, '/api/versions/latest')
    expect(fetcher).toHaveBeenNthCalledWith(2, '/api/versions/network%2Fpreview')
    expect(fetcher).toHaveBeenNthCalledWith(3, '/api/quality/latest')
    expect(fetcher).toHaveBeenNthCalledWith(4, '/api/versions/v1/quality-report')
  })

  it('loads version-specific adaptation reports', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      versionId: 'network-g9',
      matchedPoints: 8,
      sourceCounts: {
        pointType: { 'topology-degree': 4 },
        pointSize: { 'adjacent-line': 3 },
        elevation: { 'line-endpoint': 2 },
      },
      examples: [{ pointId: 'P-1', connectedLineIds: ['L-1'] }],
    })))
    const api = createApiClient('/api', fetcher)

    await expect(api.getAdaptationReport('network/g9')).resolves.toMatchObject({
      versionId: 'network-g9',
      matchedPoints: 8,
      examples: [{ pointId: 'P-1', connectedLineIds: ['L-1'] }],
    })
    expect(fetcher).toHaveBeenCalledWith('/api/versions/network%2Fg9/adaptation-report')
  })

  it('lists, publishes, and rolls back build versions', async () => {
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/versions') && init == null) {
        return new Response(JSON.stringify({
          versions: [
            { version: 'network-new', status: 'ready', tilesetUrl: '/tiles/network-new/tileset.json' },
          ],
        }))
      }

      return new Response(JSON.stringify({
        version: url.includes('rollback') ? 'network-old' : 'network-new',
        tilesetUrl: url.includes('rollback')
          ? '/tiles/network-old/tileset.json'
          : '/tiles/network-new/tileset.json',
        metadataUrl: '/tiles/metadata.json',
        qualityReportUrl: '/tiles/quality-report.json',
      }))
    })
    const api = createApiClient('/api', fetcher)

    await expect(api.listVersions()).resolves.toMatchObject([
      { version: 'network-new', status: 'ready' },
    ])
    await expect(api.publishVersion('network-new')).resolves.toMatchObject({
      version: 'network-new',
      tilesetUrl: '/tiles/network-new/tileset.json',
    })
    await expect(api.rollbackVersion('network-old')).resolves.toMatchObject({
      version: 'network-old',
      tilesetUrl: '/tiles/network-old/tileset.json',
    })

    expect(fetcher).toHaveBeenNthCalledWith(1, '/api/versions')
    expect(fetcher).toHaveBeenNthCalledWith(2, '/api/versions/network-new/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(fetcher).toHaveBeenNthCalledWith(3, '/api/versions/network-old/rollback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
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

  it('exports and imports build template migration packages', async () => {
    const template = {
      ...createReferenceBuildTemplate(),
      id: 'template-1-imported',
      dataSourceId: 'source-env',
    }
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/build-templates/template%2F1/export')) {
        return new Response(JSON.stringify({
          schemaVersion: 'build-template.v1',
          template: {
            ...template,
            id: 'template/1',
          },
        }))
      }

      return new Response(JSON.stringify({
        id: 'template-1-imported',
        dataSourceId: 'target-env',
      }), { status: 201 })
    })
    const api = createApiClient('/api', fetcher)

    await expect(api.exportBuildTemplate('template/1')).resolves.toEqual({
      schemaVersion: 'build-template.v1',
      template: {
        ...template,
        id: 'template/1',
      },
    })
    await expect(api.importBuildTemplate({
      schemaVersion: 'build-template.v1',
      template,
      dataSourceId: 'target-env',
    })).resolves.toEqual({
      id: 'template-1-imported',
      dataSourceId: 'target-env',
    })
    await expect(api.importBuildTemplate(template)).resolves.toEqual({
      id: 'template-1-imported',
      dataSourceId: 'target-env',
    })

    expect(fetcher).toHaveBeenNthCalledWith(1, '/api/build-templates/template%2F1/export')
    expect(fetcher).toHaveBeenNthCalledWith(2, '/api/build-templates/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        schemaVersion: 'build-template.v1',
        template,
        dataSourceId: 'target-env',
      }),
    })
    expect(fetcher).toHaveBeenNthCalledWith(3, '/api/build-templates/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(template),
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
