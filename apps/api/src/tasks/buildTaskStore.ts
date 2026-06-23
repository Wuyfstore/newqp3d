import { join } from 'node:path'
import { rm } from 'node:fs/promises'

import type {
  BuildTask,
  BuildTaskCreateInput,
  BuildTaskLogLevel,
  BuildTaskStore,
  BuildTaskUpdateInput,
} from './buildTaskTypes.js'

export interface MemoryBuildTaskStoreOptions {
  stagingRoot?: string
  cleanupStaging?: (stagingDir: string) => Promise<void> | void
  now?: () => Date
}

export function createMemoryBuildTaskStore(options: MemoryBuildTaskStoreOptions = {}): BuildTaskStore {
  const tasks = new Map<string, BuildTask>()
  const stagingRoot = options.stagingRoot ?? join(process.cwd(), 'data', 'build-staging')
  const now = options.now ?? (() => new Date())
  const cleanupStaging = options.cleanupStaging ?? (async stagingDir => {
    await rm(stagingDir, { recursive: true, force: true })
  })
  let nextId = 1

  return {
    async create(input) {
      const timestamp = now().toISOString()
      const id = `build-${timestamp.replace(/[-:.TZ]/g, '')}-${String(nextId++).padStart(4, '0')}`
      const task: BuildTask = {
        id,
        templateId: input.template.id,
        templateName: input.template.name,
        templateVersion: input.template.version,
        status: 'queued',
        progress: 0,
        stagingDir: join(stagingRoot, id),
        createdAt: timestamp,
        updatedAt: timestamp,
        logs: [],
      }
      tasks.set(id, task)
      return cloneTask(task)
    },
    async list() {
      return [...tasks.values()]
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .map(cloneTask)
    },
    async get(id) {
      const task = tasks.get(id)
      return task == null ? null : cloneTask(task)
    },
    async update(id, update) {
      const task = requireTask(tasks, id)
      const updated: BuildTask = {
        ...task,
        ...definedUpdate(update),
        updatedAt: now().toISOString(),
      }
      tasks.set(id, updated)
      return cloneTask(updated)
    },
    async appendLog(id, level, message) {
      const task = requireTask(tasks, id)
      const updated: BuildTask = {
        ...task,
        updatedAt: now().toISOString(),
        logs: [
          ...task.logs,
          {
            index: task.logs.length,
            timestamp: now().toISOString(),
            level,
            message,
          },
        ],
      }
      tasks.set(id, updated)
      return cloneTask(updated)
    },
    async cancel(id) {
      const task = requireTask(tasks, id)
      if (isTerminal(task.status)) {
        return cloneTask(task)
      }

      const timestamp = now().toISOString()
      const updated: BuildTask = {
        ...task,
        status: 'canceled',
        completedAt: timestamp,
        updatedAt: timestamp,
      }
      tasks.set(id, updated)
      return cloneTask(updated)
    },
    async cleanupStaging(id) {
      const task = requireTask(tasks, id)
      await cleanupStaging(task.stagingDir)
    },
  }
}

function definedUpdate(update: BuildTaskUpdateInput): BuildTaskUpdateInput {
  return Object.fromEntries(
    Object.entries(update).filter(([, value]) => value !== undefined),
  ) as BuildTaskUpdateInput
}

function requireTask(tasks: Map<string, BuildTask>, id: string): BuildTask {
  const task = tasks.get(id)
  if (task == null) {
    throw new Error(`Build task not found: ${id}`)
  }
  return task
}

function isTerminal(status: BuildTask['status']): boolean {
  return status === 'completed' || status === 'failed' || status === 'canceled'
}

function cloneTask(task: BuildTask): BuildTask {
  return {
    ...task,
    logs: task.logs.map(log => ({ ...log })),
  }
}
