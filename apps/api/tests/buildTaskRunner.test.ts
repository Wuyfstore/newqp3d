import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { createReferenceBuildTemplate } from '@new-qp3d/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { BuildTask, BuildTaskStatus } from '../src/server.js'
import { createCliBuildTaskRunner } from '../src/tasks/buildTaskRunner.js'

let tempRoot: string

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'qp3d-cli-runner-'))
})

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true })
})

describe('CLI build task runner', () => {
  it('passes the task id as output version and cleans pipeline staging artifacts on cancel', async () => {
    const task = createTask()
    const outputRoot = join(tempRoot, 'tiles')
    let canceled = false
    const statusUpdates: BuildTaskStatus[] = []
    const runner = createCliBuildTaskRunner({
      command: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      outputRoot,
    })

    const startPromise = runner.start({
      task,
      template: createReferenceBuildTemplate(),
      async setStatus(status) {
        statusUpdates.push(status)
      },
      async log() {},
      isCanceled: () => canceled,
    })

    await vi.waitFor(async () => {
      await expect(pathExists(join(task.stagingDir, 'build-template.json'))).resolves.toBe(true)
    })
    expect(statusUpdates).toContain('preprocessing')
    expect(statusUpdates).toContain('tiling')

    for (const path of [
      join(outputRoot, `.staging-${task.id}`),
      join(outputRoot, `.incoming-${task.id}`),
      join(outputRoot, task.id),
    ]) {
      await mkdir(path, { recursive: true })
    }

    canceled = true
    await runner.cancel?.(task.id)
    await expect(startPromise).resolves.toEqual({ canceled: true })
    await expect(pathExists(join(outputRoot, `.staging-${task.id}`))).resolves.toBe(false)
    await expect(pathExists(join(outputRoot, `.incoming-${task.id}`))).resolves.toBe(false)
    await expect(pathExists(join(outputRoot, task.id))).resolves.toBe(false)
  })
})

function createTask(): BuildTask {
  return {
    id: 'build-cleanup-test',
    templateId: 'template-1',
    templateName: '参数化模板',
    templateVersion: '1.0.0',
    status: 'queued',
    progress: 0,
    stagingDir: join(tempRoot, 'task-staging', 'build-cleanup-test'),
    createdAt: '2026-06-23T00:00:00.000Z',
    updatedAt: '2026-06-23T00:00:00.000Z',
    logs: [],
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}
