import type { FastifyInstance } from 'fastify'

import { runBuildTemplatePreflight } from '../preflight/buildTemplatePreflight.js'
import type { AccessControl } from '../accessControl.js'
import type { ApiRepository, BuildTemplateStore } from '../server.js'
import type {
  BuildTask,
  BuildTaskLogLevel,
  BuildTaskRunner,
  BuildTaskStatus,
  BuildTaskStore,
} from '../tasks/buildTaskTypes.js'

export async function registerBuildTaskRoutes(
  app: FastifyInstance,
  repository: ApiRepository,
  templateStore: BuildTemplateStore,
  taskStore: BuildTaskStore,
  runner: BuildTaskRunner,
  accessControl: AccessControl,
): Promise<void> {
  const canceled = new Set<string>()
  const requireTaskRead = accessControl.requireCapability('taskRead')
  const requireTaskWrite = accessControl.requireCapability('taskWrite')

  app.get('/api/build-tasks', { preHandler: requireTaskRead }, async () => {
    return { tasks: await taskStore.list() }
  })

  app.get('/api/build-tasks/:id', { preHandler: requireTaskRead }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const task = await taskStore.get(id)
    if (task == null) {
      return reply.code(404).send({ error: 'Build task not found' })
    }
    return task
  })

  app.post('/api/build-tasks', { preHandler: requireTaskWrite }, async (request, reply) => {
    const body = (request.body ?? {}) as { templateId?: unknown }
    const templateId = typeof body.templateId === 'string' ? body.templateId.trim() : ''
    if (!templateId) {
      return reply.code(400).send({ error: 'templateId is required' })
    }

    const template = await templateStore.get(templateId)
    if (template == null) {
      return reply.code(404).send({ error: 'Build template not found' })
    }

    const preflight = await runBuildTemplatePreflight(repository, template)
    if (!preflight.canBuild) {
      return reply.code(409).send({
        error: 'Build template preflight failed',
        preflight,
      })
    }

    const task = await taskStore.create({ template })
    void runTask(task, template, taskStore, runner, canceled)
    return reply.code(201).send(task)
  })

  app.post('/api/build-tasks/:id/cancel', { preHandler: requireTaskWrite }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const task = await taskStore.get(id)
    if (task == null) {
      return reply.code(404).send({ error: 'Build task not found' })
    }
    if (isTerminalStatus(task.status)) {
      return reply.code(409).send({ error: `Build task is already ${task.status}` })
    }

    canceled.add(id)
    await taskStore.appendLog(id, 'warn', '取消任务，清理 staging 目录')
    const canceledTask = await taskStore.cancel(id)
    await runner.cancel?.(id)
    await taskStore.cleanupStaging(id)
    return canceledTask
  })
}

async function runTask(
  task: BuildTask,
  template: Awaited<ReturnType<BuildTemplateStore['get']>> & {},
  taskStore: BuildTaskStore,
  runner: BuildTaskRunner,
  canceled: Set<string>,
): Promise<void> {
  let operationQueue = Promise.resolve()
  const enqueue = (operation: () => Promise<void>) => {
    operationQueue = operationQueue.then(operation, operation)
    return operationQueue
  }
  const setStatus = (status: BuildTaskStatus, progress?: number) => enqueue(async () => {
    await taskStore.update(task.id, {
      status,
      ...(progress === undefined ? {} : { progress }),
      ...(status === 'preprocessing' || status === 'tiling' || status === 'validating'
        ? { startedAt: new Date().toISOString() }
        : {}),
    })
  })
  const log = (message: string, level: BuildTaskLogLevel = 'info') => enqueue(async () => {
    await taskStore.appendLog(task.id, level, message)
  })

  try {
    const result = await runner.start({
      task,
      template,
      setStatus,
      log,
      isCanceled: () => canceled.has(task.id),
    })
    await operationQueue

    if (result.canceled || canceled.has(task.id)) {
      await taskStore.cancel(task.id)
      await taskStore.cleanupStaging(task.id)
      return
    }

    await taskStore.update(task.id, {
      status: 'completed',
      progress: 100,
      completedAt: new Date().toISOString(),
      ...(result.outputVersion === undefined ? {} : { outputVersion: result.outputVersion }),
    })
  } catch (error) {
    if (canceled.has(task.id)) {
      await taskStore.cancel(task.id)
      await taskStore.cleanupStaging(task.id)
      return
    }

    const message = error instanceof Error ? error.message : String(error)
    await operationQueue.catch(() => undefined)
    await taskStore.appendLog(task.id, 'error', message)
    await taskStore.update(task.id, {
      status: 'failed',
      failureReason: message,
      completedAt: new Date().toISOString(),
    })
  }
}

function isTerminalStatus(status: BuildTaskStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'canceled'
}
