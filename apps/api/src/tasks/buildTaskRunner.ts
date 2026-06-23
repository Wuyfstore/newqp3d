import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import type {
  BuildTaskRunner,
  BuildTaskRunnerContext,
  BuildTaskRunnerResult,
} from './buildTaskTypes.js'

export interface CliBuildTaskRunnerOptions {
  cwd?: string
  command?: string
  args?: string[]
  outputRoot?: string
}

export function createCliBuildTaskRunner(options: CliBuildTaskRunnerOptions = {}): BuildTaskRunner {
  const running = new Map<string, ChildProcessWithoutNullStreams>()
  const outputRoots = new Map<string, string>()

  return {
    async start(context) {
      await context.setStatus('preprocessing', 5)
      const templatePath = join(context.task.stagingDir, 'build-template.json')
      await mkdir(context.task.stagingDir, { recursive: true })
      await writeFile(templatePath, `${JSON.stringify(context.template, null, 2)}\n`)

      await context.setStatus('tiling', 30)
      const outputRoot = options.outputRoot ?? 'data/tiles'
      const command = options.command ?? process.execPath
      const args = options.args ?? [
        'packages/pipeline/dist/cli.js',
        'build',
        '--source',
        'postgis',
        '--output',
        outputRoot,
        '--version',
        context.task.id,
        '--template',
        templatePath,
      ]

      const child = spawn(command, args, {
        cwd: options.cwd ?? resolve(process.cwd()),
        env: process.env,
      })
      running.set(context.task.id, child)
      outputRoots.set(context.task.id, outputRoot)

      let stdout = ''
      child.stdout.on('data', chunk => {
        const text = String(chunk)
        stdout += text
        appendProcessLogs(context, text, 'info')
      })
      child.stderr.on('data', chunk => appendProcessLogs(context, String(chunk), 'warn'))

      const exitCode = await new Promise<number | null>((resolveExit, rejectExit) => {
        child.once('error', rejectExit)
        child.once('exit', code => resolveExit(code))
      }).finally(() => {
        running.delete(context.task.id)
      })

      if (context.isCanceled()) {
        await cleanupPipelineOutput(outputRoot, context.task.id)
        return { canceled: true }
      }
      if (exitCode !== 0) {
        throw new Error(`pipeline exited with code ${exitCode ?? 'unknown'}`)
      }

      context.setStatus('validating', 90)
      const outputVersion = readOutputVersion(stdout)
      return outputVersion === undefined ? {} : { outputVersion }
    },
    async cancel(taskId) {
      running.get(taskId)?.kill('SIGTERM')
      const outputRoot = outputRoots.get(taskId)
      if (outputRoot) {
        await cleanupPipelineOutput(outputRoot, taskId)
      }
    },
  }
}

async function cleanupPipelineOutput(outputRoot: string, taskId: string): Promise<void> {
  await Promise.all([
    rm(join(outputRoot, `.staging-${taskId}`), { recursive: true, force: true }),
    rm(join(outputRoot, `.incoming-${taskId}`), { recursive: true, force: true }),
    rm(join(outputRoot, taskId), { recursive: true, force: true }),
  ])
}

function appendProcessLogs(context: BuildTaskRunnerContext, text: string, level: 'info' | 'warn'): void {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed) {
      context.log(trimmed, level)
    }
  }
}

function readOutputVersion(stdout: string): string | undefined {
  const jsonStart = stdout.lastIndexOf('{')
  if (jsonStart < 0) {
    return undefined
  }

  try {
    const parsed = JSON.parse(stdout.slice(jsonStart)) as { version?: unknown }
    return typeof parsed.version === 'string' ? parsed.version : undefined
  } catch {
    return undefined
  }
}
