import {
  BUILD_TEMPLATE_SCHEMA_VERSION,
  type BuildTemplate,
  createReferenceBuildTemplate,
} from '@new-qp3d/shared'
import { describe, expect, it } from 'vitest'

import type { ApiRepository, BuildTemplateStore, DataSourceTableProfile } from '../src/server.js'
import { createServer } from '../src/server.js'

function createRepository(overrides: Partial<ApiRepository> = {}): ApiRepository {
  return {
    search: async () => [],
    getLine: async () => null,
    getPoint: async () => null,
    getLatestVersion: async () => null,
    getLatestQuality: async () => null,
    listVersions: async () => [],
    getVersion: async () => null,
    getQualityReport: async () => null,
    getAdaptationReport: async () => null,
    publishVersion: async () => null,
    rollbackVersion: async () => null,
    listSchemas: async () => [],
    listTables: async () => [],
    getTableProfile: async (_schema, table) => table.includes('xbtj') ? lineProfile() : pointProfile(),
    ...overrides,
  }
}

function createTemplateStore(template: BuildTemplate | null): BuildTemplateStore {
  return {
    list: async () => [],
    get: async () => template,
    create: async next => next,
    update: async (_id, next) => next,
    duplicate: async () => createReferenceBuildTemplate(),
    export: async () => ({
      schemaVersion: BUILD_TEMPLATE_SCHEMA_VERSION,
      template: template ?? createReferenceBuildTemplate(),
    }),
    import: async next => next,
  }
}

describe('build template preflight routes', () => {
  it('passes the current reference template with warnings for missing optional point parameters', async () => {
    const template = createReferenceBuildTemplate()
    const app = await createServer(createRepository(), {
      templateStore: createTemplateStore(template),
    })

    try {
      const response = await app.inject({
        method: 'POST',
        url: `/api/build-templates/${template.id}/preflight`,
      })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({
        templateId: template.id,
        canBuild: true,
        summary: {
          errors: 0,
          warnings: 2,
          infos: 2,
        },
        checks: expect.arrayContaining([
          expect.objectContaining({ severity: 'info', code: 'line-geometry-compatible', path: 'lineTable.geometryField' }),
          expect.objectContaining({ severity: 'info', code: 'point-geometry-compatible', path: 'pointTable.geometryField' }),
          expect.objectContaining({ severity: 'warning', code: 'point-size-coverage-low', path: 'pointTable.fieldMapping.size' }),
          expect.objectContaining({ severity: 'warning', code: 'point-elevation-coverage-low', path: 'pointTable.fieldMapping.surfaceElevation' }),
        ]),
      })
    } finally {
      await app.close()
    }
  })

  it('blocks builds when mapped fields or geometry are missing', async () => {
    const template = createReferenceBuildTemplate()
    const app = await createServer(createRepository({
      getTableProfile: async (_schema, table) => table.includes('xbtj')
        ? {
            ...lineProfile(),
            geometryFields: [],
            fields: lineProfile().fields.filter(field => field.name !== 'guid'),
          }
        : pointProfile(),
    }), {
      templateStore: createTemplateStore(template),
    })

    try {
      const response = await app.inject({
        method: 'POST',
        url: `/api/build-templates/${template.id}/preflight`,
      })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({
        canBuild: false,
        summary: {
          errors: 2,
        },
        checks: expect.arrayContaining([
          expect.objectContaining({ severity: 'error', code: 'geometry-field-missing', path: 'lineTable.geometryField' }),
          expect.objectContaining({ severity: 'error', code: 'mapped-field-missing', path: 'lineTable.fieldMapping.id' }),
        ]),
      })
    } finally {
      await app.close()
    }
  })

  it('returns validation errors for invalid ad hoc template payloads', async () => {
    const invalidTemplate = {
      ...createReferenceBuildTemplate(),
      lod: {
        ...createReferenceBuildTemplate().lod,
        maxDepth: 0,
      },
    }
    const app = await createServer(createRepository(), {
      templateStore: createTemplateStore(null),
    })

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/build-templates/preflight',
        payload: invalidTemplate,
      })

      expect(response.statusCode).toBe(400)
      expect(response.json()).toEqual({
        error: 'Invalid build template',
        validationErrors: [{ path: 'lod.maxDepth', reason: 'must be an integer greater than or equal to 1' }],
      })
    } finally {
      await app.close()
    }
  })
})

function lineProfile(): DataSourceTableProfile {
  return {
    schema: 'public',
    table: 'sys_016_tancexbtjinfo_sde',
    estimatedRowCount: 1000,
    geometryFields: [{ name: 'geom', srid: 3857, geometryType: 'LINESTRING' }],
    inferredTableKind: 'line',
    recommendedFieldMapping: {},
    fields: [
      field('guid', 0, 1000),
      field('qdbm', 0.01, 990),
      field('zdbm', 0.01, 990),
      field('gwlx', 0, 3),
      field('gs', 0, 3),
      field('cz', 0.05, 10),
      field('gg', 0.1, 100),
      field('qdndbg', 0.2, 600),
      field('zdndbg', 0.2, 600),
      field('qdms', 0.1, 500),
      field('zdms', 0.1, 500),
      field('lx', 0.05, 3),
      field('gdcd', 0.02, 900),
    ],
  }
}

function pointProfile(): DataSourceTableProfile {
  return {
    schema: 'public',
    table: 'sys_016_tancedbtjinfo_sde',
    estimatedRowCount: 800,
    geometryFields: [{ name: 'geom', srid: 3857, geometryType: 'POINT' }],
    inferredTableKind: 'point',
    recommendedFieldMapping: {},
    fields: [
      field('gdbm', 0, 800),
      field('lbmc', 0.05, 20),
      field('dmbg', 0.72, 120),
      field('jgcc', 0.8, 30),
      field('jgxz', 0.4, 5),
      field('js', 0.3, 80),
      field('jgcz', 0.5, 10),
      field('gg', 0.5, 20),
      field('kj', 0.6, 20),
    ],
  }
}

function field(name: string, nullRate: number, uniqueCount: number) {
  return {
    name,
    dataType: 'text',
    isNullable: nullRate > 0,
    samples: [],
    nullRate,
    uniqueCount,
  }
}
