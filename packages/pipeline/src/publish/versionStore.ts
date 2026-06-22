import { cp, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export interface PublishVersionInput {
  outputRoot: string
  version: string
  files: Record<string, string | Uint8Array>
}

export interface PublishedVersion {
  version: string
  versionDirectory: string
  latestPath: string
  latest: LatestManifest
}

export interface LatestManifest {
  version: string
  tilesetUrl: string
  metadataUrl: string
  qualityReportUrl: string
}

const REQUIRED_FILES = ['tileset.json', 'root.glb', 'quality-report.json'] as const

export async function publishVersion(input: PublishVersionInput): Promise<PublishedVersion> {
  const versionDirectory = join(input.outputRoot, input.version)
  const stagingDirectory = join(input.outputRoot, `.staging-${input.version}`)
  const incomingDirectory = join(input.outputRoot, `.incoming-${input.version}`)
  const latestPath = join(input.outputRoot, 'latest.json')

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
    await cp(stagingDirectory, incomingDirectory, { recursive: true })
    await validateRequiredFiles(incomingDirectory)
    await rm(versionDirectory, { force: true, recursive: true })
    await rename(incomingDirectory, versionDirectory)
    await rm(stagingDirectory, { force: true, recursive: true }).catch(() => undefined)

    const latest = createLatestManifest(input.version)
    await writeFile(latestPath, `${JSON.stringify(latest, null, 2)}\n`)

    return {
      version: input.version,
      versionDirectory,
      latestPath,
      latest,
    }
  } catch (error) {
    await rm(stagingDirectory, { force: true, recursive: true }).catch(() => undefined)
    await rm(incomingDirectory, { force: true, recursive: true }).catch(() => undefined)
    throw error
  }
}

export async function validatePublishedVersion(outputRoot: string, version: string): Promise<void> {
  await validateRequiredFiles(join(outputRoot, version))
}

export async function readLatestManifest(outputRoot: string): Promise<LatestManifest> {
  return JSON.parse(await readFile(join(outputRoot, 'latest.json'), 'utf8')) as LatestManifest
}

function createLatestManifest(version: string): LatestManifest {
  return {
    version,
    tilesetUrl: `/tiles/${version}/tileset.json`,
    metadataUrl: `/tiles/${version}/metadata.json`,
    qualityReportUrl: `/tiles/${version}/quality-report.json`,
  }
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
