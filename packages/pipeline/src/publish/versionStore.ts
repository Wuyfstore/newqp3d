import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export interface PrepareVersionInput {
  outputRoot: string
  version: string
  files: Record<string, string | Uint8Array>
  templateId?: string
  templateVersion?: string
  buildTaskId?: string
}

export interface PreparedVersion {
  version: string
  versionDirectory: string
  recordPath: string
  record: VersionRecord
}

export interface PublishVersionInput {
  outputRoot: string
  version: string
}

export interface PublishedVersion {
  version: string
  versionDirectory: string
  latestPath: string
  latest: LatestManifest
  record: VersionRecord
}

export interface LatestManifest {
  version: string
  tilesetUrl: string
  metadataUrl: string
  qualityReportUrl: string
  adaptationReportUrl?: string
  flowTilesetUrl?: string
  flowMode?: 'embedded'
}

export type VersionRecordStatus = 'ready' | 'published' | 'superseded'

export interface VersionRecord extends LatestManifest {
  status: VersionRecordStatus
  createdAt: string
  updatedAt: string
  templateId?: string
  templateVersion?: string
  buildTaskId?: string
}

const REQUIRED_FILES = ['tileset.json', 'root.glb', 'quality-report.json'] as const

export async function prepareVersion(input: PrepareVersionInput): Promise<PreparedVersion> {
  const versionDirectory = join(input.outputRoot, input.version)
  const stagingDirectory = join(input.outputRoot, `.staging-${input.version}`)
  const incomingDirectory = join(input.outputRoot, `.incoming-${input.version}`)
  const recordPath = join(versionDirectory, 'version-record.json')

  await rm(stagingDirectory, { force: true, recursive: true })
  await rm(incomingDirectory, { force: true, recursive: true })
  await mkdir(stagingDirectory, { recursive: true })

  try {
    for (const [relativePath, contents] of Object.entries(input.files)) {
      const target = join(stagingDirectory, relativePath)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, contents)
    }

    await validateRequiredFiles(stagingDirectory)
    const record = createVersionRecord(input.version, input.files, {
      ...(input.templateId === undefined ? {} : { templateId: input.templateId }),
      ...(input.templateVersion === undefined ? {} : { templateVersion: input.templateVersion }),
      ...(input.buildTaskId === undefined ? {} : { buildTaskId: input.buildTaskId }),
    })
    await writeFile(join(stagingDirectory, 'version-record.json'), `${JSON.stringify(record, null, 2)}\n`)
    await cp(stagingDirectory, incomingDirectory, { recursive: true })
    await validateRequiredFiles(incomingDirectory)
    await rm(versionDirectory, { force: true, recursive: true })
    await rename(incomingDirectory, versionDirectory)
    await rm(stagingDirectory, { force: true, recursive: true }).catch(() => undefined)

    return {
      version: input.version,
      versionDirectory,
      recordPath,
      record,
    }
  } catch (error) {
    await rm(stagingDirectory, { force: true, recursive: true }).catch(() => undefined)
    await rm(incomingDirectory, { force: true, recursive: true }).catch(() => undefined)
    throw error
  }
}

export async function publishVersion(input: PublishVersionInput): Promise<PublishedVersion> {
  const versionDirectory = join(input.outputRoot, input.version)
  const latestPath = join(input.outputRoot, 'latest.json')

  await validatePublishedVersion(input.outputRoot, input.version)
  const record = await readVersionRecord(input.outputRoot, input.version)
  const latest = latestFromRecord(record)
  const publishedRecord = markRecord(record, 'published')

  await writeFile(join(versionDirectory, 'version-record.json'), `${JSON.stringify(publishedRecord, null, 2)}\n`)
  await markOtherPublishedRecordsSuperseded(input.outputRoot, input.version)
  await writeFile(latestPath, `${JSON.stringify(latest, null, 2)}\n`)

  return {
    version: input.version,
    versionDirectory,
    latestPath,
    latest,
    record: publishedRecord,
  }
}

export async function validatePublishedVersion(outputRoot: string, version: string): Promise<void> {
  await validateRequiredFiles(join(outputRoot, version))
  await stat(join(outputRoot, version, 'version-record.json'))
}

export async function readLatestManifest(outputRoot: string): Promise<LatestManifest> {
  return JSON.parse(await readFile(join(outputRoot, 'latest.json'), 'utf8')) as LatestManifest
}

export async function listVersionRecords(outputRoot: string): Promise<VersionRecord[]> {
  let entries: string[]
  try {
    entries = await readdir(outputRoot)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return []
    }

    throw error
  }

  const records = await Promise.all(entries
    .filter(entry => !entry.startsWith('.') && entry !== 'latest.json')
    .map(async entry => {
      try {
        return await readVersionRecord(outputRoot, entry)
      } catch {
        return null
      }
    }))

  return records
    .filter((record): record is VersionRecord => record != null)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}

export async function readVersionRecord(outputRoot: string, version: string): Promise<VersionRecord> {
  return JSON.parse(await readFile(join(outputRoot, version, 'version-record.json'), 'utf8')) as VersionRecord
}

function createVersionRecord(
  version: string,
  files: Record<string, string | Uint8Array>,
  metadata: {
    templateId?: string
    templateVersion?: string
    buildTaskId?: string
  },
): VersionRecord {
  const now = new Date().toISOString()
  const record: VersionRecord = {
    version,
    status: 'ready',
    tilesetUrl: `/tiles/${version}/tileset.json`,
    metadataUrl: `/tiles/${version}/metadata.json`,
    qualityReportUrl: `/tiles/${version}/quality-report.json`,
    createdAt: now,
    updatedAt: now,
  }
  if (files['flow/tileset.json'] && files['flow/root.glb'])
    record.flowTilesetUrl = `/tiles/${version}/flow/tileset.json`
  if (files['adaptation-report.json'])
    record.adaptationReportUrl = `/tiles/${version}/adaptation-report.json`
  if (files['.flow-mode'])
    record.flowMode = 'embedded'
  if (metadata.templateId !== undefined)
    record.templateId = metadata.templateId
  if (metadata.templateVersion !== undefined)
    record.templateVersion = metadata.templateVersion
  if (metadata.buildTaskId !== undefined)
    record.buildTaskId = metadata.buildTaskId

  return record
}

function latestFromRecord(record: VersionRecord): LatestManifest {
  return {
    version: record.version,
    tilesetUrl: record.tilesetUrl,
    metadataUrl: record.metadataUrl,
    qualityReportUrl: record.qualityReportUrl,
    ...(record.adaptationReportUrl === undefined ? {} : { adaptationReportUrl: record.adaptationReportUrl }),
    ...(record.flowTilesetUrl === undefined ? {} : { flowTilesetUrl: record.flowTilesetUrl }),
    ...(record.flowMode === undefined ? {} : { flowMode: record.flowMode }),
  }
}

function markRecord(record: VersionRecord, status: VersionRecordStatus): VersionRecord {
  return {
    ...record,
    status,
    updatedAt: new Date().toISOString(),
  }
}

async function markOtherPublishedRecordsSuperseded(outputRoot: string, publishedVersion: string): Promise<void> {
  const records = await listVersionRecords(outputRoot)
  await Promise.all(records
    .filter(record => record.version !== publishedVersion && record.status === 'published')
    .map(async record => {
      const next = markRecord(record, 'superseded')
      await writeFile(
        join(outputRoot, record.version, 'version-record.json'),
        `${JSON.stringify(next, null, 2)}\n`,
      )
    }))
}

async function validateRequiredFiles(directory: string): Promise<void> {
  for (const file of REQUIRED_FILES) {
    try {
      const result = await stat(join(directory, file))
      if (!result.isFile()) {
        throw new Error(`Missing required publish file: ${file}`)
      }
    } catch {
      throw new Error(`Missing required publish file: ${file}`)
    }
  }
}
