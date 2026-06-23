import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import {
  type BuildTemplate,
  assertValidBuildTemplate,
  validateBuildTemplate,
} from '@new-qp3d/shared'
import { QP3D_WORKSPACE_ROOT, loadRuntimeConfig } from '@new-qp3d/runtime-config'

import type { BuildTemplateStore, BuildTemplateSummary } from '../server.js'

export interface FileTemplateStoreOptions {
  root?: string
}

interface StoredTemplateFile {
  template: BuildTemplate
  updatedAt: string
}

export function createFileTemplateStore(options: FileTemplateStoreOptions = {}): BuildTemplateStore {
  const root = options.root ?? resolveDefaultTemplateRoot()

  return {
    async list() {
      await ensureRoot(root)
      const files = await readdir(root)
      const summaries = await Promise.all(
        files
          .filter(file => file.endsWith('.json'))
          .map(async file => toSummary(await readStoredTemplate(resolve(root, file)))),
      )

      return summaries.sort((left, right) => left.id.localeCompare(right.id))
    },

    async get(id) {
      validateTemplateId(id)
      try {
        return (await readStoredTemplate(templatePath(root, id))).template
      } catch (error) {
        if (isMissingFile(error)) {
          return null
        }

        throw error
      }
    },

    async create(template) {
      const normalized = validateForWrite(template)
      await assertTemplateDoesNotExist(root, normalized.id)
      await writeStoredTemplate(root, normalized)
      return normalized
    },

    async update(id, template) {
      validateTemplateId(id)
      const existing = await this.get(id)
      if (existing == null) {
        throw new TemplateNotFoundError(id)
      }

      const normalized = validateForWrite({
        ...template,
        id,
        version: nextPatchVersion(existing.version),
      })
      await writeStoredTemplate(root, normalized)
      return normalized
    },

    async duplicate(id, options) {
      validateTemplateId(id)
      validateTemplateId(options.id)
      const existing = await this.get(id)
      if (existing == null) {
        throw new TemplateNotFoundError(id)
      }

      const duplicated = validateForWrite({
        ...existing,
        id: options.id,
        name: options.name ?? `${existing.name} 副本`,
        status: 'draft',
        version: '1.0.0',
      })
      await assertTemplateDoesNotExist(root, duplicated.id)
      await writeStoredTemplate(root, duplicated)
      return duplicated
    },

    async import(template) {
      const normalized = validateForWrite(template)
      await assertTemplateDoesNotExist(root, normalized.id)
      await writeStoredTemplate(root, normalized)
      return normalized
    },
  }
}

export class TemplateNotFoundError extends Error {
  constructor(id: string) {
    super(`Build template not found: ${id}`)
    this.name = 'TemplateNotFoundError'
  }
}

export class TemplateValidationError extends Error {
  constructor(readonly validationErrors: Array<{ path: string; reason: string }>) {
    super('Invalid build template')
    this.name = 'TemplateValidationError'
  }
}

export class TemplateConflictError extends Error {
  constructor(id: string) {
    super(`Build template already exists: ${id}`)
    this.name = 'TemplateConflictError'
  }
}

function validateForWrite(template: BuildTemplate): BuildTemplate {
  const result = validateBuildTemplate(template)
  if (!result.valid) {
    throw new TemplateValidationError(result.errors)
  }

  assertValidBuildTemplate(template)
  validateTemplateId(template.id)
  return sanitizeBuildTemplate(template)
}

function sanitizeBuildTemplate(template: BuildTemplate): BuildTemplate {
  return {
    id: template.id,
    name: template.name,
    description: template.description,
    version: template.version,
    status: template.status,
    dataSourceId: template.dataSourceId,
    lineTable: {
      schema: template.lineTable.schema,
      table: template.lineTable.table,
      geometryField: template.lineTable.geometryField,
      fieldMapping: { ...template.lineTable.fieldMapping },
    },
    pointTable: {
      schema: template.pointTable.schema,
      table: template.pointTable.table,
      geometryField: template.pointTable.geometryField,
      fieldMapping: { ...template.pointTable.fieldMapping },
    },
    units: { ...template.units },
    defaults: { ...template.defaults },
    flowRule: {
      field: template.flowRule.field,
      forwardValues: [...template.flowRule.forwardValues],
      reverseValues: [...template.flowRule.reverseValues],
      unknownStrategy: template.flowRule.unknownStrategy,
    },
    lod: { ...template.lod },
    output: { ...template.output },
  }
}

async function writeStoredTemplate(root: string, template: BuildTemplate): Promise<void> {
  await ensureRoot(root)
  await writeFile(
    templatePath(root, template.id),
    `${JSON.stringify({ template, updatedAt: new Date().toISOString() }, null, 2)}\n`,
    'utf8',
  )
}

async function readStoredTemplate(path: string): Promise<StoredTemplateFile> {
  const parsed = JSON.parse(await readFile(path, 'utf8')) as StoredTemplateFile
  assertValidBuildTemplate(parsed.template)
  return parsed
}

function toSummary(stored: StoredTemplateFile): BuildTemplateSummary {
  return {
    id: stored.template.id,
    name: stored.template.name,
    description: stored.template.description,
    version: stored.template.version,
    status: stored.template.status,
    dataSourceId: stored.template.dataSourceId,
    updatedAt: stored.updatedAt,
  }
}

function templatePath(root: string, id: string): string {
  return resolve(root, `${validateTemplateId(id)}.json`)
}

async function ensureRoot(root: string): Promise<void> {
  await mkdir(root, { recursive: true })
}

async function assertTemplateDoesNotExist(root: string, id: string): Promise<void> {
  const existing = await readExistingTemplate(root, id)
  if (existing !== null) {
    throw new TemplateConflictError(id)
  }
}

async function readExistingTemplate(root: string, id: string): Promise<StoredTemplateFile | null> {
  try {
    return await readStoredTemplate(templatePath(root, id))
  } catch (error) {
    if (isMissingFile(error)) {
      return null
    }

    throw error
  }
}

function validateTemplateId(id: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(id)) {
    throw new TemplateValidationError([{ path: 'id', reason: 'invalid template id' }])
  }

  return id
}

function nextPatchVersion(version: string): string {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
  if (match == null) {
    return version
  }

  const [, major, minor, patch] = match
  return `${major}.${minor}.${Number(patch) + 1}`
}

function resolveDefaultTemplateRoot(): string {
  const config = loadRuntimeConfig()
  return resolve(config[QP3D_WORKSPACE_ROOT] ?? process.cwd(), 'data/build-templates')
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}
