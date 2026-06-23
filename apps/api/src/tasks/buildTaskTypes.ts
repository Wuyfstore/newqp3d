import type { BuildTemplate } from '@new-qp3d/shared'

export type BuildTaskStatus =
  | 'queued'
  | 'preprocessing'
  | 'tiling'
  | 'validating'
  | 'completed'
  | 'failed'
  | 'canceled'

export type BuildTaskLogLevel = 'info' | 'warn' | 'error'

export interface BuildTaskLogEntry {
  index: number
  timestamp: string
  level: BuildTaskLogLevel
  message: string
}

export interface BuildTask {
  id: string
  templateId: string
  templateName: string
  templateVersion: string
  status: BuildTaskStatus
  progress: number
  stagingDir: string
  createdAt: string
  updatedAt: string
  startedAt?: string
  completedAt?: string
  outputVersion?: string
  failureReason?: string
  logs: BuildTaskLogEntry[]
}

export interface BuildTaskCreateInput {
  template: BuildTemplate
}

export interface BuildTaskUpdateInput {
  status?: BuildTaskStatus
  progress?: number
  outputVersion?: string
  failureReason?: string
  startedAt?: string
  completedAt?: string
}

export interface BuildTaskStore {
  create(input: BuildTaskCreateInput): Promise<BuildTask>
  list(): Promise<BuildTask[]>
  get(id: string): Promise<BuildTask | null>
  update(id: string, update: BuildTaskUpdateInput): Promise<BuildTask>
  appendLog(id: string, level: BuildTaskLogLevel, message: string): Promise<BuildTask>
  cancel(id: string): Promise<BuildTask>
  cleanupStaging(id: string): Promise<void>
}

export interface BuildTaskRunnerResult {
  outputVersion?: string
  canceled?: boolean
}

export interface BuildTaskRunnerContext {
  task: BuildTask
  template: BuildTemplate
  setStatus(status: BuildTaskStatus, progress?: number): Promise<void>
  log(message: string, level?: BuildTaskLogLevel): Promise<void>
  isCanceled(): boolean
}

export interface BuildTaskRunner {
  start(context: BuildTaskRunnerContext): Promise<BuildTaskRunnerResult>
  cancel?(taskId: string): Promise<void> | void
}
