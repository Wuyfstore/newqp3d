import { createReferenceBuildTemplate } from '@new-qp3d/shared'
import { describe, expect, it, vi } from 'vitest'

import { createTemplateWorkbench } from '../src/ui/templateWorkbench'
import type { ApiClient } from '../src/services/apiClient'

function createApi(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    search: async () => [],
    getLine: async () => ({}),
    getPoint: async () => ({}),
    getLatestVersion: async () => ({ version: 'v1', tilesetUrl: '/tiles/v1/tileset.json' }),
    getLatestQuality: async () => ({}),
    listSchemas: async () => [{ name: 'public' }],
    listTables: async () => [
      { schema: 'public', name: 'sys_016_tancexbtjinfo_sde', type: 'table', estimatedRows: 10 },
      { schema: 'public', name: 'sys_016_tancedbtjinfo_sde', type: 'table', estimatedRows: 8 },
    ],
    getTableProfile: async (_schema, table) => table.includes('xbtj')
      ? {
          schema: 'public',
          table,
          estimatedRowCount: 10,
          geometryFields: [{ name: 'geom', srid: 3857, geometryType: 'LINESTRING' }],
          fields: [],
          inferredTableKind: 'line',
          recommendedFieldMapping: {
            id: 'guid',
            startNodeId: 'qdbm',
            endNodeId: 'zdbm',
            spec: 'gg',
            flowDirection: 'lx',
          },
        }
      : {
          schema: 'public',
          table,
          estimatedRowCount: 8,
          geometryFields: [{ name: 'geom', srid: 3857, geometryType: 'POINT' }],
          fields: [],
          inferredTableKind: 'point',
          recommendedFieldMapping: {
            id: 'gdbm',
            pointType: 'lbmc',
            surfaceElevation: 'dmbg',
            size: 'jgcc',
          },
        },
    createBuildTemplate: async template => template as never,
    ...overrides,
  }
}

describe('template workbench', () => {
  it('renders datasource selectors and saves a recommended build template', async () => {
    const savedTemplates: unknown[] = []
    const api = createApi({
      createBuildTemplate: vi.fn(async template => {
        savedTemplates.push(template)
        return template as never
      }),
    })
    const workbench = createTemplateWorkbench({ apiClient: api, dataSourceId: 'local-qcwebserver' })
    document.body.replaceChildren(workbench.element)

    await workbench.load()

    expect(workbench.element.querySelector<HTMLSelectElement>('[data-template-schema]')?.value).toBe('public')
    expect(workbench.element.textContent).toContain('sys_016_tancexbtjinfo_sde')
    expect(workbench.element.textContent).toContain('sys_016_tancedbtjinfo_sde')

    workbench.element.querySelector<HTMLInputElement>('[data-template-name]')!.value = '参数化模板'
    workbench.element.querySelector<HTMLButtonElement>('[data-template-save]')!.click()
    await vi.waitFor(() => expect(savedTemplates.length).toBe(1))

    expect(savedTemplates[0]).toMatchObject({
      id: 'parametric-template',
      name: '参数化模板',
      dataSourceId: 'local-qcwebserver',
      lineTable: {
        schema: 'public',
        table: 'sys_016_tancexbtjinfo_sde',
        geometryField: 'geom',
        fieldMapping: {
          id: 'guid',
          startNodeId: 'qdbm',
          endNodeId: 'zdbm',
          flowDirection: 'lx',
        },
      },
      pointTable: {
        schema: 'public',
        table: 'sys_016_tancedbtjinfo_sde',
        geometryField: 'geom',
        fieldMapping: {
          id: 'gdbm',
          pointType: 'lbmc',
          surfaceElevation: 'dmbg',
          size: 'jgcc',
        },
      },
      units: createReferenceBuildTemplate().units,
      defaults: createReferenceBuildTemplate().defaults,
      lod: createReferenceBuildTemplate().lod,
    })
    expect(workbench.element.textContent).toContain('模板已保存')
  })

  it('lets users override recommended field mappings before saving', async () => {
    const savedTemplates: unknown[] = []
    const workbench = createTemplateWorkbench({
      apiClient: createApi({
        createBuildTemplate: vi.fn(async template => {
          savedTemplates.push(template)
          return template as never
        }),
      }),
      dataSourceId: 'local-qcwebserver',
    })
    document.body.replaceChildren(workbench.element)

    await workbench.load()
    workbench.element.querySelector<HTMLInputElement>('[data-template-name]')!.value = '覆盖字段模板'
    workbench.element.querySelector<HTMLInputElement>('[data-field="line.id"]')!.value = 'custom_guid'
    workbench.element.querySelector<HTMLInputElement>('[data-field="point.id"]')!.value = 'custom_gdbm'
    workbench.element.querySelector<HTMLButtonElement>('[data-template-save]')!.click()
    await vi.waitFor(() => expect(savedTemplates.length).toBe(1))

    expect(savedTemplates[0]).toMatchObject({
      lineTable: { fieldMapping: { id: 'custom_guid' } },
      pointTable: { fieldMapping: { id: 'custom_gdbm' } },
    })
  })
})
