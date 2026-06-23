import { describe, expect, it, vi } from 'vitest'

import type { ApiClient, BuildTask } from '../src/services/apiClient'
import { createBuildTaskCenter } from '../src/ui/buildTaskCenter'

function createTask(overrides: Partial<BuildTask> = {}): BuildTask {
  return {
    id: 'build-1',
    templateId: 'template-1',
    templateName: '参数化模板',
    templateVersion: '1.0.0',
    status: 'tiling',
    progress: 60,
    stagingDir: '/tmp/build-1',
    createdAt: '2026-06-23T00:00:00.000Z',
    updatedAt: '2026-06-23T00:01:00.000Z',
    logs: [
      { index: 0, timestamp: '2026-06-23T00:00:10.000Z', level: 'info', message: '开始写入瓦片' },
    ],
    ...overrides,
  }
}

function createApi(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    search: async () => [],
    getLine: async () => ({}),
    getPoint: async () => ({}),
    getLatestVersion: async () => ({ version: 'v1', tilesetUrl: '/tiles/v1/tileset.json' }),
    getLatestQuality: async () => ({}),
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
    createBuildTemplate: async template => template as never,
    createBuildTask: async () => createTask({ status: 'queued', progress: 0 }),
    listBuildTasks: async () => [],
    getBuildTask: async id => createTask({ id }),
    cancelBuildTask: async id => createTask({ id, status: 'canceled' }),
    ...overrides,
  }
}

describe('build task center', () => {
  it('renders task status, progress, output version, failure reason, and logs', async () => {
    const task = createTask({
      status: 'failed',
      progress: 70,
      failureReason: 'tile write failed',
      outputVersion: 'network-g8',
      logs: [
        { index: 0, timestamp: '2026-06-23T00:00:10.000Z', level: 'info', message: '开始写入瓦片' },
        { index: 1, timestamp: '2026-06-23T00:00:20.000Z', level: 'error', message: 'tile write failed' },
      ],
    })
    const center = createBuildTaskCenter({
      apiClient: createApi({
        listBuildTasks: vi.fn(async () => [task]),
        getBuildTask: vi.fn(async id => createTask({ ...task, id })),
      }),
      templateId: 'template-1',
    })
    document.body.replaceChildren(center.element)

    await center.load()

    expect(center.element.textContent).toContain('参数化模板')
    expect(center.element.textContent).toContain('失败')
    expect(center.element.textContent).toContain('70%')
    expect(center.element.textContent).toContain('network-g8')
    expect(center.element.textContent).toContain('tile write failed')
    expect(center.element.textContent).toContain('开始写入瓦片')
  })

  it('creates a build task and refreshes the task list', async () => {
    const tasks: BuildTask[] = []
    const api = createApi({
      createBuildTask: vi.fn(async () => {
        const task = createTask({ status: 'queued', progress: 0 })
        tasks.push(task)
        return task
      }),
      listBuildTasks: vi.fn(async () => tasks),
    })
    const center = createBuildTaskCenter({ apiClient: api, templateId: 'template-1' })
    document.body.replaceChildren(center.element)

    await center.load()
    center.element.querySelector<HTMLButtonElement>('[data-build-task-create]')!.click()
    await vi.waitFor(() => expect(api.createBuildTask).toHaveBeenCalledWith('template-1'))

    expect(center.element.textContent).toContain('queued')
    expect(center.element.textContent).toContain('0%')
  })

  it('uses the current template id when starting a build task', async () => {
    let templateId = 'template-old'
    const api = createApi({
      createBuildTask: vi.fn(async nextTemplateId => createTask({
        templateId: nextTemplateId,
        status: 'queued',
        progress: 0,
      })),
      listBuildTasks: vi.fn(async () => []),
    })
    const center = createBuildTaskCenter({
      apiClient: api,
      getTemplateId: () => templateId,
    })
    document.body.replaceChildren(center.element)

    await center.load()
    templateId = 'template-new'
    center.element.querySelector<HTMLButtonElement>('[data-build-task-create]')!.click()
    await vi.waitFor(() => expect(api.createBuildTask).toHaveBeenCalledWith('template-new'))
  })

  it('cancels running tasks and stops polling after destroy', async () => {
    vi.useFakeTimers()
    try {
      const listBuildTasks = vi.fn(async () => [createTask()])
      const cancelBuildTask = vi.fn(async id => createTask({
        id,
        status: 'canceled',
        logs: [
          { index: 0, timestamp: '2026-06-23T00:01:00.000Z', level: 'warn', message: '取消任务，清理 staging 目录' },
        ],
      }))
      const center = createBuildTaskCenter({
        apiClient: createApi({ listBuildTasks, cancelBuildTask }),
        templateId: 'template-1',
        pollIntervalMs: 1000,
      })
      document.body.replaceChildren(center.element)

      await center.load()
      center.element.querySelector<HTMLButtonElement>('[data-build-task-cancel]')!.click()
      await vi.waitFor(() => expect(cancelBuildTask).toHaveBeenCalledWith('build-1'))
      expect(center.element.textContent).toContain('已取消')

      center.destroy()
      const callCountAfterDestroy = listBuildTasks.mock.calls.length
      await vi.advanceTimersByTimeAsync(3000)
      expect(listBuildTasks).toHaveBeenCalledTimes(callCountAfterDestroy)
    } finally {
      vi.useRealTimers()
    }
  })
})
