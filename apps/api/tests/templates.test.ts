import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { createReferenceBuildTemplate } from '@new-qp3d/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createFileTemplateStore } from '../src/templates/fileTemplateStore.js'
import type { ApiRepository } from '../src/server.js'
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
    getTableProfile: async () => ({
      schema: 'public',
      table: 'empty',
      estimatedRowCount: null,
      geometryFields: [],
      fields: [],
      inferredTableKind: 'unknown',
      recommendedFieldMapping: {},
    }),
    ...overrides,
  }
}

let tempRoot: string

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'qp3d-template-store-'))
})

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true })
})

describe('template management routes', () => {
  it('creates, lists, reads, updates, duplicates, exports, and imports templates', async () => {
    const store = createFileTemplateStore({ root: tempRoot })
    const app = await createServer(createRepository(), { templateStore: store })
    const template = {
      ...createReferenceBuildTemplate(),
      id: 'reference-template',
      status: 'draft',
    }

    try {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/api/build-templates',
        payload: template,
      })
      expect(createResponse.statusCode).toBe(201)
      expect(createResponse.json()).toMatchObject({
        id: 'reference-template',
        version: '1.0.0',
        status: 'draft',
      })

      const listResponse = await app.inject({ method: 'GET', url: '/api/build-templates' })
      expect(listResponse.statusCode).toBe(200)
      expect(listResponse.json()).toMatchObject({
        templates: [{
          id: 'reference-template',
          name: '溧阳供排水管网参考模板',
          version: '1.0.0',
          status: 'draft',
        }],
      })

      const detailResponse = await app.inject({ method: 'GET', url: '/api/build-templates/reference-template' })
      expect(detailResponse.statusCode).toBe(200)
      expect(detailResponse.json().lineTable.fieldMapping.id).toBe('guid')

      const updateResponse = await app.inject({
        method: 'PUT',
        url: '/api/build-templates/reference-template',
        payload: {
          ...template,
          name: '更新后的模板',
          status: 'validated',
        },
      })
      expect(updateResponse.statusCode).toBe(200)
      expect(updateResponse.json()).toMatchObject({
        id: 'reference-template',
        name: '更新后的模板',
        version: '1.0.1',
        status: 'validated',
      })

      const duplicateResponse = await app.inject({
        method: 'POST',
        url: '/api/build-templates/reference-template/duplicate',
        payload: { id: 'reference-template-copy', name: '复制模板' },
      })
      expect(duplicateResponse.statusCode).toBe(201)
      expect(duplicateResponse.json()).toMatchObject({
        id: 'reference-template-copy',
        name: '复制模板',
        status: 'draft',
      })

      const exportResponse = await app.inject({ method: 'GET', url: '/api/build-templates/reference-template/export' })
      expect(exportResponse.statusCode).toBe(200)
      expect(exportResponse.json()).toMatchObject({
        id: 'reference-template',
        name: '更新后的模板',
        status: 'validated',
      })
      expect(exportResponse.body).not.toContain('postgres://')
      expect(exportResponse.body).not.toContain('password')

      const importResponse = await app.inject({
        method: 'POST',
        url: '/api/build-templates/import',
        payload: {
          ...template,
          id: 'imported-template',
          name: '导入模板',
        },
      })
      expect(importResponse.statusCode).toBe(201)
      expect(importResponse.json()).toMatchObject({
        id: 'imported-template',
        name: '导入模板',
      })
    } finally {
      await app.close()
    }
  })

  it('persists templates across store instances', async () => {
    const template = {
      ...createReferenceBuildTemplate(),
      id: 'persisted-template',
    }
    await createFileTemplateStore({ root: tempRoot }).create(template)

    const reloadedStore = createFileTemplateStore({ root: tempRoot })

    await expect(reloadedStore.get('persisted-template')).resolves.toMatchObject({
      id: 'persisted-template',
      lineTable: {
        table: 'sys_016_tancexbtjinfo_sde',
      },
    })
  })

  it('rejects invalid templates and missing templates with clear HTTP statuses', async () => {
    const store = createFileTemplateStore({ root: tempRoot })
    const app = await createServer(createRepository(), { templateStore: store })
    const invalidTemplate = {
      ...createReferenceBuildTemplate(),
      id: 'invalid-template',
      units: {
        ...createReferenceBuildTemplate().units,
        pipeDiameter: 'feet',
      },
    }

    try {
      const invalidCreateResponse = await app.inject({
        method: 'POST',
        url: '/api/build-templates',
        payload: invalidTemplate,
      })
      expect(invalidCreateResponse.statusCode).toBe(400)
      expect(invalidCreateResponse.json()).toEqual({
        error: 'Invalid build template',
        validationErrors: [{ path: 'units.pipeDiameter', reason: 'unsupported unit' }],
      })

      const missingResponse = await app.inject({ method: 'GET', url: '/api/build-templates/missing-template' })
      expect(missingResponse.statusCode).toBe(404)
    } finally {
      await app.close()
    }
  })

  it('strips unknown payload fields before storing or exporting templates', async () => {
    const store = createFileTemplateStore({ root: tempRoot })
    const app = await createServer(createRepository(), { templateStore: store })

    try {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/api/build-templates',
        payload: {
          ...createReferenceBuildTemplate(),
          id: 'sanitized-template',
          databaseUrl: 'postgres://user:password@example.invalid/qp3d',
          password: 'secret',
          lineTable: {
            ...createReferenceBuildTemplate().lineTable,
            password: 'line-secret',
          },
        },
      })
      expect(createResponse.statusCode).toBe(201)

      const exportResponse = await app.inject({ method: 'GET', url: '/api/build-templates/sanitized-template/export' })
      expect(exportResponse.statusCode).toBe(200)
      expect(exportResponse.body).not.toContain('postgres://')
      expect(exportResponse.body).not.toContain('password')
      expect(exportResponse.json()).not.toHaveProperty('databaseUrl')
      expect(exportResponse.json().lineTable).not.toHaveProperty('password')
    } finally {
      await app.close()
    }
  })

  it('rejects duplicate template ids and malformed duplicate requests', async () => {
    const store = createFileTemplateStore({ root: tempRoot })
    const app = await createServer(createRepository(), { templateStore: store })
    const template = createReferenceBuildTemplate()

    try {
      const firstCreateResponse = await app.inject({
        method: 'POST',
        url: '/api/build-templates',
        payload: template,
      })
      expect(firstCreateResponse.statusCode).toBe(201)

      const duplicateCreateResponse = await app.inject({
        method: 'POST',
        url: '/api/build-templates',
        payload: template,
      })
      expect(duplicateCreateResponse.statusCode).toBe(409)

      const missingBodyDuplicateResponse = await app.inject({
        method: 'POST',
        url: `/api/build-templates/${template.id}/duplicate`,
      })
      expect(missingBodyDuplicateResponse.statusCode).toBe(400)

      const duplicateToExistingResponse = await app.inject({
        method: 'POST',
        url: `/api/build-templates/${template.id}/duplicate`,
        payload: { id: template.id },
      })
      expect(duplicateToExistingResponse.statusCode).toBe(409)
    } finally {
      await app.close()
    }
  })
})
