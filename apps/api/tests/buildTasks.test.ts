import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  BUILD_TEMPLATE_SCHEMA_VERSION,
  type BuildTemplate,
  createReferenceBuildTemplate,
} from '@new-qp3d/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  ApiRepository,
  BuildTaskRunner,
  BuildTaskStore,
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
    get: async id => template && id === template.id ? template : null,
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

let stagingRoot: string

beforeEach(async () => {
  stagingRoot = await mkdtemp(join(tmpdir(), 'qp3d-build-tasks-'))
})

afterEach(async () => {
  await rm(stagingRoot, { recursive: true, force: true })
})

describe('build task routes', () => {
  it('creates a non-blocking build task and exposes pollable status, progress, logs, and output version', async () => {
    const template = createReferenceBuildTemplate()
    let releaseRunner: ((version: string) => void) | undefined
    const runnerStarted = vi.fn()
    const runner: BuildTaskRunner = {
      start(context) {
        runnerStarted(context.task.id)
        context.log('构建任务已进入预处理')
        context.setStatus('preprocessing', 15)
        return new Promise(resolve => {
          releaseRunner = (version) => {
            context.log('瓦片写入完成')
            resolve({ outputVersion: version })
          }
        })
      },
    }
    const app = await createServer(createRepository(), {
      buildTaskStore: createMemoryBuildTaskStore({ stagingRoot }),
      buildTaskRunner: runner,
      templateStore: createTemplateStore(template),
    })

    try {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/api/build-tasks',
        payload: { templateId: template.id },
      })

      expect(createResponse.statusCode).toBe(201)
      expect(createResponse.json()).toMatchObject({
        templateId: template.id,
        templateName: template.name,
        status: 'queued',
        progress: 0,
      })
      expect(runnerStarted).toHaveBeenCalledTimes(1)

      await vi.waitFor(async () => {
        const statusResponse = await app.inject({
          method: 'GET',
          url: `/api/build-tasks/${createResponse.json().id}`,
        })
        expect(statusResponse.json()).toMatchObject({
          status: 'preprocessing',
          progress: 15,
        })
      })

      releaseRunner?.('network-g8')
      await vi.waitFor(async () => {
        const detailResponse = await app.inject({
          method: 'GET',
          url: `/api/build-tasks/${createResponse.json().id}`,
        })
        expect(detailResponse.json()).toMatchObject({
          status: 'completed',
          progress: 100,
          outputVersion: 'network-g8',
          logs: expect.arrayContaining([
            expect.objectContaining({ message: '构建任务已进入预处理' }),
            expect.objectContaining({ message: '瓦片写入完成' }),
          ]),
        })
      })

      const listResponse = await app.inject({ method: 'GET', url: '/api/build-tasks' })
      expect(listResponse.statusCode).toBe(200)
      expect(listResponse.json()).toMatchObject({
        tasks: [
          {
            id: createResponse.json().id,
            templateId: template.id,
            status: 'completed',
            outputVersion: 'network-g8',
          },
        ],
      })
    } finally {
      await app.close()
    }
  })

  it('preserves failure reason and logs when the background build fails', async () => {
    const template = createReferenceBuildTemplate()
    const app = await createServer(createRepository(), {
      buildTaskStore: createMemoryBuildTaskStore({ stagingRoot }),
      buildTaskRunner: {
        async start(context) {
          context.log('开始写入瓦片')
          context.setStatus('tiling', 60)
          throw new Error('tile write failed')
        },
      },
      templateStore: createTemplateStore(template),
    })

    try {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/api/build-tasks',
        payload: { templateId: template.id },
      })

      await vi.waitFor(async () => {
        const detailResponse = await app.inject({
          method: 'GET',
          url: `/api/build-tasks/${createResponse.json().id}`,
        })
        expect(detailResponse.json()).toMatchObject({
          status: 'failed',
          progress: 60,
          failureReason: 'tile write failed',
          logs: expect.arrayContaining([
            expect.objectContaining({ level: 'info', message: '开始写入瓦片' }),
            expect.objectContaining({ level: 'error', message: 'tile write failed' }),
          ]),
        })
      })
    } finally {
      await app.close()
    }
  })

  it('cancels a running task and cleans its staging directory', async () => {
    const template = createReferenceBuildTemplate()
    const cleanupStaging = vi.fn()
    const cancelTask = vi.fn()
    const app = await createServer(createRepository(), {
      buildTaskStore: createMemoryBuildTaskStore({ stagingRoot, cleanupStaging }),
      buildTaskRunner: {
        start(context) {
          context.setStatus('tiling', 50)
          return new Promise(resolve => {
            cancelTask.mockImplementation(() => {
              context.log('构建任务已取消')
              resolve({ canceled: true })
            })
          })
        },
        cancel: cancelTask,
      },
      templateStore: createTemplateStore(template),
    })

    try {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/api/build-tasks',
        payload: { templateId: template.id },
      })
      const taskId = createResponse.json().id as string

      await vi.waitFor(async () => {
        const detailResponse = await app.inject({ method: 'GET', url: `/api/build-tasks/${taskId}` })
        expect(detailResponse.json().status).toBe('tiling')
      })

      const cancelResponse = await app.inject({
        method: 'POST',
        url: `/api/build-tasks/${taskId}/cancel`,
      })
      expect(cancelResponse.statusCode).toBe(200)
      expect(cancelResponse.json()).toMatchObject({
        id: taskId,
        status: 'canceled',
      })
      expect(cancelTask).toHaveBeenCalledWith(taskId)

      await vi.waitFor(() => expect(cleanupStaging).toHaveBeenCalledWith(expect.stringContaining(taskId)))
      const detailResponse = await app.inject({ method: 'GET', url: `/api/build-tasks/${taskId}` })
      expect(detailResponse.json()).toMatchObject({
        status: 'canceled',
        logs: expect.arrayContaining([
          expect.objectContaining({ level: 'warn', message: '取消任务，清理 staging 目录' }),
          expect.objectContaining({ level: 'info', message: '构建任务已取消' }),
        ]),
      })
    } finally {
      await app.close()
    }
  })

  it('rejects cancel requests for terminal tasks without mutating logs or staging', async () => {
    const template = createReferenceBuildTemplate()
    const cleanupStaging = vi.fn()
    const app = await createServer(createRepository(), {
      buildTaskStore: createMemoryBuildTaskStore({ stagingRoot, cleanupStaging }),
      buildTaskRunner: {
        async start() {
          return { outputVersion: 'network-terminal' }
        },
      },
      templateStore: createTemplateStore(template),
    })

    try {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/api/build-tasks',
        payload: { templateId: template.id },
      })
      const taskId = createResponse.json().id as string

      await vi.waitFor(async () => {
        const detailResponse = await app.inject({ method: 'GET', url: `/api/build-tasks/${taskId}` })
        expect(detailResponse.json().status).toBe('completed')
      })

      const cancelResponse = await app.inject({
        method: 'POST',
        url: `/api/build-tasks/${taskId}/cancel`,
      })
      expect(cancelResponse.statusCode).toBe(409)
      expect(cancelResponse.json()).toEqual({ error: 'Build task is already completed' })
      expect(cleanupStaging).not.toHaveBeenCalled()

      const detailResponse = await app.inject({ method: 'GET', url: `/api/build-tasks/${taskId}` })
      expect(detailResponse.json()).toMatchObject({
        status: 'completed',
        logs: [],
      })
    } finally {
      await app.close()
    }
  })

  it('rejects missing templates and preflight errors before starting the runner', async () => {
    const runner: BuildTaskRunner = {
      start: vi.fn(async () => ({ outputVersion: 'should-not-run' })),
    }
    const app = await createServer(createRepository({
      getTableProfile: async (_schema, table) => table.includes('xbtj')
        ? {
            ...lineProfile(),
            geometryFields: [],
          }
        : pointProfile(),
    }), {
      buildTaskStore: createMemoryBuildTaskStore({ stagingRoot }),
      buildTaskRunner: runner,
      templateStore: createTemplateStore(createReferenceBuildTemplate()),
    })

    try {
      const missingResponse = await app.inject({
        method: 'POST',
        url: '/api/build-tasks',
        payload: { templateId: 'missing-template' },
      })
      expect(missingResponse.statusCode).toBe(404)

      const blockedResponse = await app.inject({
        method: 'POST',
        url: '/api/build-tasks',
        payload: { templateId: createReferenceBuildTemplate().id },
      })
      expect(blockedResponse.statusCode).toBe(409)
      expect(blockedResponse.json()).toMatchObject({
        error: 'Build template preflight failed',
        preflight: {
          canBuild: false,
          summary: { errors: 1 },
        },
      })
      expect(runner.start).not.toHaveBeenCalled()
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
