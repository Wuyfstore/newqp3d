import {
  BUILD_TEMPLATE_SCHEMA_VERSION,
  type BuildTemplate,
  createReferenceBuildTemplate,
} from '@new-qp3d/shared'
import { describe, expect, it, vi } from 'vitest'

import type {
  ApiRepository,
  BuildTaskRunner,
  BuildTemplateStore,
  DataSourceTableProfile,
} from '../src/server.js'
import { createServer } from '../src/server.js'
import { createMemoryBuildTaskStore } from '../src/tasks/buildTaskStore.js'

function createRepository(overrides: Partial<ApiRepository> = {}): ApiRepository {
  return {
    search: async () => [],
    getLine: async () => null,
    getPoint: async () => null,
    getLatestVersion: async () => ({ version: 'network-ready' }),
    getLatestQuality: async () => null,
    listVersions: async () => [{ version: 'network-ready', status: 'ready' }],
    getVersion: async version => ({ version }),
    getQualityReport: async version => ({ versionId: version }),
    getAdaptationReport: async version => ({ versionId: version }),
    publishVersion: async version => ({ version, status: 'published' }),
    rollbackVersion: async version => ({ version, status: 'published' }),
    listSchemas: async () => [{ name: 'public' }],
    listTables: async () => [],
    getTableProfile: async (_schema, table) => table.includes('xbtj') ? lineProfile() : pointProfile(),
    ...overrides,
  }
}

function createTemplateStore(template: BuildTemplate = createReferenceBuildTemplate()): BuildTemplateStore {
  return {
    list: async () => [],
    get: async id => id === template.id ? template : null,
    create: async next => next,
    update: async (_id, next) => next,
    duplicate: async () => template,
    export: async () => ({
      schemaVersion: BUILD_TEMPLATE_SCHEMA_VERSION,
      template,
    }),
    import: async next => next,
  }
}

const roleHeader = 'x-qp3d-role'

describe('role-based access control', () => {
  it('preserves unrestricted local behavior when access control is disabled', async () => {
    const app = await createServer(createRepository())

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/versions/network-ready/publish',
      })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({ version: 'network-ready' })
    } finally {
      await app.close()
    }
  })

  it('allows viewers to read versions and reports but blocks build, publish, and datasource operations', async () => {
    const app = await createServer(createRepository({
      search: async () => [{
        type: 'line',
        id: 'L-1',
        label: 'L-1',
        longitude: 119.48,
        latitude: 31.41,
      }],
      getLine: async () => ({ guid: 'L-1' }),
      getPoint: async () => ({ gdbm: 'P-1' }),
    }), {
      accessControl: { enabled: true },
      templateStore: createTemplateStore(),
      buildTaskStore: createMemoryBuildTaskStore(),
      buildTaskRunner: idleRunner(),
    })

    try {
      const latestResponse = await app.inject({
        method: 'GET',
        url: '/api/versions/latest',
        headers: { [roleHeader]: 'viewer' },
      })
      const reportResponse = await app.inject({
        method: 'GET',
        url: '/api/versions/network-ready/quality-report',
        headers: { [roleHeader]: 'viewer' },
      })
      const templateResponse = await app.inject({
        method: 'POST',
        url: '/api/build-templates',
        headers: { [roleHeader]: 'viewer' },
        payload: createReferenceBuildTemplate(),
      })
      const buildResponse = await app.inject({
        method: 'POST',
        url: '/api/build-tasks',
        headers: { [roleHeader]: 'viewer' },
        payload: { templateId: createReferenceBuildTemplate().id },
      })
      const publishResponse = await app.inject({
        method: 'POST',
        url: '/api/versions/network-ready/publish',
        headers: { [roleHeader]: 'viewer' },
      })
      const datasourceResponse = await app.inject({
        method: 'GET',
        url: '/api/datasource/schemas',
        headers: { [roleHeader]: 'viewer' },
      })
      const searchResponse = await app.inject({
        method: 'GET',
        url: '/api/search?q=L-1',
        headers: { [roleHeader]: 'viewer' },
      })
      const lineDetailResponse = await app.inject({
        method: 'GET',
        url: '/api/lines/L-1',
        headers: { [roleHeader]: 'viewer' },
      })
      const pointDetailResponse = await app.inject({
        method: 'GET',
        url: '/api/points/P-1',
        headers: { [roleHeader]: 'viewer' },
      })
      const templateListResponse = await app.inject({
        method: 'GET',
        url: '/api/build-templates',
        headers: { [roleHeader]: 'viewer' },
      })
      const taskListResponse = await app.inject({
        method: 'GET',
        url: '/api/build-tasks',
        headers: { [roleHeader]: 'viewer' },
      })

      expect(latestResponse.statusCode).toBe(200)
      expect(reportResponse.statusCode).toBe(200)
      expect(templateResponse.statusCode).toBe(403)
      expect(buildResponse.statusCode).toBe(403)
      expect(publishResponse.statusCode).toBe(403)
      expect(datasourceResponse.statusCode).toBe(403)
      expect(searchResponse.statusCode).toBe(403)
      expect(lineDetailResponse.statusCode).toBe(403)
      expect(pointDetailResponse.statusCode).toBe(403)
      expect(templateListResponse.statusCode).toBe(403)
      expect(taskListResponse.statusCode).toBe(403)
    } finally {
      await app.close()
    }
  })

  it('allows builders to manage templates and build tasks but blocks publish and datasource administration', async () => {
    const runner: BuildTaskRunner = {
      start: vi.fn(async () => ({ outputVersion: 'network-built' })),
    }
    const template = createReferenceBuildTemplate()
    const app = await createServer(createRepository(), {
      accessControl: { enabled: true },
      templateStore: createTemplateStore(template),
      buildTaskStore: createMemoryBuildTaskStore(),
      buildTaskRunner: runner,
    })

    try {
      const templateResponse = await app.inject({
        method: 'POST',
        url: '/api/build-templates',
        headers: { [roleHeader]: 'builder' },
        payload: template,
      })
      const buildResponse = await app.inject({
        method: 'POST',
        url: '/api/build-tasks',
        headers: { [roleHeader]: 'builder' },
        payload: { templateId: template.id },
      })
      const publishResponse = await app.inject({
        method: 'POST',
        url: '/api/versions/network-ready/publish',
        headers: { [roleHeader]: 'builder' },
      })
      const datasourceResponse = await app.inject({
        method: 'GET',
        url: '/api/datasource/schemas',
        headers: { [roleHeader]: 'builder' },
      })

      expect(templateResponse.statusCode).toBe(201)
      expect(buildResponse.statusCode).toBe(201)
      expect(publishResponse.statusCode).toBe(403)
      expect(datasourceResponse.statusCode).toBe(403)
    } finally {
      await app.close()
    }
  })

  it('allows publishers to publish and rollback but blocks build and datasource administration', async () => {
    const app = await createServer(createRepository(), {
      accessControl: { enabled: true },
      templateStore: createTemplateStore(),
      buildTaskStore: createMemoryBuildTaskStore(),
      buildTaskRunner: idleRunner(),
    })

    try {
      const publishResponse = await app.inject({
        method: 'POST',
        url: '/api/versions/network-ready/publish',
        headers: { [roleHeader]: 'publisher' },
      })
      const rollbackResponse = await app.inject({
        method: 'POST',
        url: '/api/versions/network-ready/rollback',
        headers: { [roleHeader]: 'publisher' },
      })
      const buildResponse = await app.inject({
        method: 'POST',
        url: '/api/build-tasks',
        headers: { [roleHeader]: 'publisher' },
        payload: { templateId: createReferenceBuildTemplate().id },
      })
      const datasourceResponse = await app.inject({
        method: 'GET',
        url: '/api/datasource/schemas',
        headers: { [roleHeader]: 'publisher' },
      })

      expect(publishResponse.statusCode).toBe(200)
      expect(rollbackResponse.statusCode).toBe(200)
      expect(buildResponse.statusCode).toBe(403)
      expect(datasourceResponse.statusCode).toBe(403)
    } finally {
      await app.close()
    }
  })

  it('allows admins to manage datasource discovery and all protected workflows', async () => {
    const template = createReferenceBuildTemplate()
    const app = await createServer(createRepository(), {
      accessControl: { enabled: true },
      templateStore: createTemplateStore(template),
      buildTaskStore: createMemoryBuildTaskStore(),
      buildTaskRunner: idleRunner(),
    })

    try {
      const datasourceResponse = await app.inject({
        method: 'GET',
        url: '/api/datasource/schemas',
        headers: { [roleHeader]: 'admin' },
      })
      const templateResponse = await app.inject({
        method: 'POST',
        url: '/api/build-templates',
        headers: { [roleHeader]: 'admin' },
        payload: template,
      })
      const buildResponse = await app.inject({
        method: 'POST',
        url: '/api/build-tasks',
        headers: { [roleHeader]: 'admin' },
        payload: { templateId: template.id },
      })
      const publishResponse = await app.inject({
        method: 'POST',
        url: '/api/versions/network-ready/publish',
        headers: { [roleHeader]: 'admin' },
      })

      expect(datasourceResponse.statusCode).toBe(200)
      expect(templateResponse.statusCode).toBe(201)
      expect(buildResponse.statusCode).toBe(201)
      expect(publishResponse.statusCode).toBe(200)
    } finally {
      await app.close()
    }
  })

  it('rejects missing or unknown roles when access control is enabled', async () => {
    const app = await createServer(createRepository(), {
      accessControl: { enabled: true },
    })

    try {
      const missingRoleResponse = await app.inject({
        method: 'GET',
        url: '/api/versions/latest',
      })
      const unknownRoleResponse = await app.inject({
        method: 'GET',
        url: '/api/versions/latest',
        headers: { [roleHeader]: 'operator' },
      })

      expect(missingRoleResponse.statusCode).toBe(401)
      expect(missingRoleResponse.json()).toMatchObject({
        error: 'Missing role',
        header: roleHeader,
      })
      expect(unknownRoleResponse.statusCode).toBe(403)
      expect(unknownRoleResponse.json()).toMatchObject({
        error: 'Unknown role',
        role: 'operator',
      })
    } finally {
      await app.close()
    }
  })
})

function idleRunner(): BuildTaskRunner {
  return {
    start: vi.fn(async () => ({ outputVersion: 'network-built' })),
  }
}

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
