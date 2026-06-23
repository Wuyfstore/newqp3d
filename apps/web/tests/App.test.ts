import { beforeEach, describe, expect, it, vi } from 'vitest'

const viewer = { destroy: vi.fn() }
const createPipeNetworkViewer = vi.fn(() => viewer)
const latestHandles = createHandles()
const freshLatestHandles = createHandles()
const previewHandles = createHandles()
const failingVersions = new Set<string>()
const loadPipeNetworkLayers = vi.fn(async (_viewer: unknown, manifest: { version: string }) => {
  if (failingVersions.has(manifest.version)) {
    throw new Error('preview glb missing')
  }

  if (manifest.version === 'network-preview') {
    return previewHandles
  }

  if (manifest.version === 'network-fresh-latest') {
    return freshLatestHandles
  }

  return latestHandles
})
const installPicking = vi.fn(() => vi.fn())
const installPipeNetworkStyles = vi.fn()
const installPanelStyles = vi.fn()
const apiClient = {
  search: vi.fn(),
  getLine: vi.fn(),
  getPoint: vi.fn(),
  getLatestVersion: vi.fn(async () => ({ version: 'network-latest', tilesetUrl: '/tiles/network-latest/tileset.json' })),
  getVersion: vi.fn(async (version: string) => ({ version, tilesetUrl: `/tiles/${version}/tileset.json` })),
  getLatestQuality: vi.fn(),
  getQualityReport: vi.fn(async version => ({ versionId: version })),
  getAdaptationReport: vi.fn(async version => ({ versionId: version })),
  listVersions: vi.fn(async () => []),
  publishVersion: vi.fn(),
  rollbackVersion: vi.fn(),
  listSchemas: vi.fn(),
  listTables: vi.fn(),
  getTableProfile: vi.fn(),
  createBuildTemplate: vi.fn(),
  exportBuildTemplate: vi.fn(),
  importBuildTemplate: vi.fn(),
  createBuildTask: vi.fn(),
  listBuildTasks: vi.fn(async () => [createCompletedTask()]),
  getBuildTask: vi.fn(async (id: string) => createCompletedTask({ id })),
  cancelBuildTask: vi.fn(),
}
const createApiClient = vi.fn(() => apiClient)

vi.mock('../src/cesium/createViewer', () => ({ createPipeNetworkViewer }))
vi.mock('../src/cesium/layers', () => ({ loadPipeNetworkLayers }))
vi.mock('../src/cesium/picking', () => ({ flyToSearchResult: vi.fn(), installPicking }))
vi.mock('../src/cesium/styles', () => ({ installPipeNetworkStyles }))
vi.mock('../src/ui/panels', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/ui/panels')>()
  return {
    ...actual,
    installPanelStyles,
  }
})
vi.mock('../src/services/apiClient', () => ({ createApiClient }))

describe('mountPipeNetworkApp', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    latestHandles.destroy.mockClear()
    latestHandles.applyState.mockClear()
    freshLatestHandles.destroy.mockClear()
    freshLatestHandles.applyState.mockClear()
    previewHandles.destroy.mockClear()
    previewHandles.applyState.mockClear()
    failingVersions.clear()
    document.body.replaceChildren()
  })

  it('previews a completed build task version without publishing latest', async () => {
    const { mountPipeNetworkApp } = await import('../src/App')
    const root = document.createElement('div')
    document.body.append(root)

    mountPipeNetworkApp(root)
    await vi.waitFor(() => expect(loadPipeNetworkLayers).toHaveBeenCalledWith(viewer, expect.objectContaining({
      version: 'network-latest',
    })))

    root.querySelector<HTMLButtonElement>('[data-open-build-task-center]')!.click()
    await vi.waitFor(() => expect(root.querySelector('[data-build-task-preview]')).not.toBeNull())
    root.querySelector<HTMLButtonElement>('[data-build-task-preview]')!.click()
    await vi.waitFor(() => expect(apiClient.getVersion).toHaveBeenCalledWith('network-preview'))

    expect(loadPipeNetworkLayers).toHaveBeenCalledWith(viewer, expect.objectContaining({
      version: 'network-preview',
      tilesetUrl: '/tiles/network-preview/tileset.json',
    }))
    expect(apiClient.publishVersion).not.toHaveBeenCalled()
    expect(apiClient.getLatestVersion).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(latestHandles.destroy).toHaveBeenCalledTimes(1))
    expect(previewHandles.applyState).toHaveBeenCalled()
  })

  it('does not let an older preview override a newer latest reload', async () => {
    const previewManifest = deferred<{ version: string, tilesetUrl: string }>()
    apiClient.getVersion.mockReturnValueOnce(previewManifest.promise)
    apiClient.publishVersion.mockResolvedValueOnce({
      version: 'network-fresh-latest',
      tilesetUrl: '/tiles/network-fresh-latest/tileset.json',
    })
    apiClient.getLatestVersion
      .mockResolvedValueOnce({ version: 'network-latest', tilesetUrl: '/tiles/network-latest/tileset.json' })
      .mockResolvedValueOnce({ version: 'network-fresh-latest', tilesetUrl: '/tiles/network-fresh-latest/tileset.json' })

    const { mountPipeNetworkApp } = await import('../src/App')
    const root = document.createElement('div')
    document.body.append(root)

    mountPipeNetworkApp(root)
    await vi.waitFor(() => expect(loadPipeNetworkLayers).toHaveBeenCalledWith(viewer, expect.objectContaining({
      version: 'network-latest',
    })))

    root.querySelector<HTMLButtonElement>('[data-open-build-task-center]')!.click()
    await vi.waitFor(() => expect(root.querySelector('[data-build-task-preview]')).not.toBeNull())
    root.querySelector<HTMLButtonElement>('[data-build-task-preview]')!.click()
    await vi.waitFor(() => expect(apiClient.getVersion).toHaveBeenCalledWith('network-preview'))

    root.querySelector<HTMLButtonElement>('[data-build-task-publish]')!.click()
    await vi.waitFor(() => expect(loadPipeNetworkLayers).toHaveBeenCalledWith(viewer, expect.objectContaining({
      version: 'network-fresh-latest',
    })))

    previewManifest.resolve({
      version: 'network-preview',
      tilesetUrl: '/tiles/network-preview/tileset.json',
    })

    await vi.waitFor(() => expect(previewHandles.destroy).toHaveBeenCalledTimes(1))
    expect(freshLatestHandles.destroy).not.toHaveBeenCalled()
  })

  it('keeps the current tileset when preview loading fails', async () => {
    apiClient.getVersion.mockResolvedValueOnce({
      version: 'network-broken',
      tilesetUrl: '/tiles/network-broken/tileset.json',
    })
    failingVersions.add('network-broken')
    const { mountPipeNetworkApp } = await import('../src/App')
    const root = document.createElement('div')
    document.body.append(root)

    mountPipeNetworkApp(root)
    await vi.waitFor(() => expect(loadPipeNetworkLayers).toHaveBeenCalledWith(viewer, expect.objectContaining({
      version: 'network-latest',
    })))

    root.querySelector<HTMLButtonElement>('[data-open-build-task-center]')!.click()
    await vi.waitFor(() => expect(root.querySelector('[data-build-task-preview]')).not.toBeNull())
    root.querySelector<HTMLButtonElement>('[data-build-task-preview]')!.click()
    await vi.waitFor(() => expect(root.textContent).toContain('版本预览失败: preview glb missing'))

    expect(latestHandles.destroy).not.toHaveBeenCalled()
  })
})

function createHandles() {
  return {
    pipeNetworkTileset: {},
    applyState: vi.fn(),
    destroy: vi.fn(),
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(nextResolve => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

function createCompletedTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 'build-1',
    templateId: 'template-1',
    templateName: '参数化模板',
    templateVersion: '1.0.0',
    status: 'completed',
    progress: 100,
    outputVersion: 'network-preview',
    stagingDir: '/tmp/build-1',
    createdAt: '2026-06-23T00:00:00.000Z',
    updatedAt: '2026-06-23T00:01:00.000Z',
    logs: [],
    ...overrides,
  }
}
