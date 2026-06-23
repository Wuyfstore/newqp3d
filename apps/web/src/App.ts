import type { Viewer } from 'cesium'

import { createPipeNetworkViewer } from './cesium/createViewer'
import { loadPipeNetworkLayers, type LayerHandles, type VersionManifest } from './cesium/layers'
import { flyToSearchResult, installPicking, type PickTarget } from './cesium/picking'
import { installPipeNetworkStyles } from './cesium/styles'
import { createApiClient, type ApiClient, type SearchResult } from './services/apiClient'
import {
  createLayerState,
  OWNERS,
  PIPE_TYPES,
  QUALITY_STATES,
  type LayerState,
} from './state/layerState'
import { installPanelStyles, renderBuildReportsPanel, renderEmptyPanel, renderPropertyPanel } from './ui/panels'
import { createBuildTaskCenter, type BuildTaskCenter } from './ui/buildTaskCenter'
import { createTemplateWorkbench, type TemplateWorkbench } from './ui/templateWorkbench'

export interface PipeNetworkApp {
  destroy(): void
}

export function mountPipeNetworkApp(root: HTMLElement): PipeNetworkApp {
  installPipeNetworkStyles()
  installPanelStyles()

  const state = createLayerState()
  const apiClient = createApiClient('/api')
  const shell = document.createElement('div')
  shell.className = 'qp3d-shell'
  shell.innerHTML = `
    <div class="qp3d-viewer" data-viewer data-testid="cesium-container"></div>
    <aside class="qp3d-toolbar" aria-label="Layer controls" data-testid="layer-tree">
      <form class="qp3d-search" data-search-form>
        <input data-search-input type="search" autocomplete="off" placeholder="搜索编码" aria-label="搜索编码">
        <button type="submit">搜索</button>
      </form>
      <div class="qp3d-search-results" data-search-results></div>
      <div class="qp3d-toolbar__section">
        <div class="qp3d-toolbar__title">管线</div>
        <div data-pipe-types></div>
      </div>
      <div class="qp3d-toolbar__section">
        <div class="qp3d-toolbar__title">权属</div>
        <div data-owners></div>
      </div>
      <div class="qp3d-toolbar__section">
        <div class="qp3d-toolbar__title">质量</div>
        <div data-quality></div>
      </div>
      <div class="qp3d-toolbar__section">
        <div class="qp3d-toolbar__title">构建</div>
        <button class="qp3d-toolbar__button" type="button" data-open-template-workbench>模板</button>
        <button class="qp3d-toolbar__button" type="button" data-open-build-task-center>任务</button>
      </div>
    </aside>
    <aside class="qp3d-property-panel" hidden aria-hidden="true"></aside>
    <footer class="qp3d-status" data-status>tileset: loading</footer>
  `

  root.replaceChildren(shell)

  const viewerContainer = requireElement<HTMLElement>(shell, '[data-viewer]')
  const status = requireElement<HTMLElement>(shell, '[data-status]')
  const propertyPanel = requireElement<HTMLElement>(shell, '.qp3d-property-panel')
  const viewer = createPipeNetworkViewer(viewerContainer)
  let handles: LayerHandles | undefined
  let templateWorkbench: TemplateWorkbench | undefined
  let buildTaskCenter: BuildTaskCenter | undefined
  let currentBuildTemplateId = 'reference-liyang-drainage-network'
  let disposed = false
  let activationRequestId = 0
  const activateVersion = async (manifest: VersionManifest, requestId: number) => {
    const nextHandles = await loadVersionManifest(viewer, apiClient, state, status, propertyPanel, manifest)
    if (disposed || requestId !== activationRequestId) {
      nextHandles.destroy()
      return
    }

    handles?.destroy()
    handles = nextHandles
    handles.applyState(state.snapshot())
  }
  const reloadLatestVersion = async () => {
    const requestId = ++activationRequestId
    status.textContent = 'tileset: reloading'
    const manifest = await apiClient.getLatestVersion()
    await activateVersion(manifest, requestId)
  }
  const previewVersion = async (version: string) => {
    const requestId = ++activationRequestId
    status.textContent = `tileset: preview loading ${version}`
    const manifest = await apiClient.getVersion(version)
    await activateVersion(manifest, requestId)
  }

  renderToolbar(shell, state, () => {
    handles?.applyState(state.snapshot())
  })
  installSearch(shell, viewer, apiClient, status, propertyPanel)
  installTemplateWorkbench(
    shell,
    apiClient,
    status,
    propertyPanel,
    () => templateWorkbench,
    next => {
      templateWorkbench = next
    },
    template => {
      currentBuildTemplateId = template.id
    },
  )
  installBuildTaskCenter(
    shell,
    apiClient,
    status,
    propertyPanel,
    () => buildTaskCenter,
    next => {
      buildTaskCenter = next
    },
    () => currentBuildTemplateId,
    reloadLatestVersion,
    previewVersion,
  )

  const disposePicking = installPicking(viewer, apiClient, {
    onPickStart() {
      status.textContent = 'selection: loading'
    },
    onPick(target) {
      showPanel(propertyPanel, renderPropertyPanel(target))
      status.textContent = `selection: ${target.type} ${target.id}`
    },
    onPickMiss() {
      hidePanel(propertyPanel)
      status.textContent = handles ? 'selection: none' : 'tileset: loading'
    },
    onPickError(error) {
      showPanel(propertyPanel, renderEmptyPanel(`属性加载失败: ${formatError(error)}`))
      status.textContent = `selection: unavailable (${formatError(error)})`
    },
  })

  void reloadLatestVersion()
    .catch((error: unknown) => {
      status.textContent = `tileset: unavailable (${formatError(error)})`
    })

  return {
    destroy() {
      disposed = true
      templateWorkbench?.destroy()
      buildTaskCenter?.destroy()
      disposePicking()
      handles?.destroy()
      viewer.destroy()
      root.replaceChildren()
    },
  }
}

function installBuildTaskCenter(
  shell: HTMLElement,
  apiClient: ApiClient,
  status: HTMLElement,
  propertyPanel: HTMLElement,
  getCenter: () => BuildTaskCenter | undefined,
  setCenter: (center: BuildTaskCenter | undefined) => void,
  getTemplateId: () => string,
  reloadLatestVersion: () => Promise<void>,
  previewVersion: (version: string) => Promise<void>,
): void {
  const button = requireElement<HTMLButtonElement>(shell, '[data-open-build-task-center]')
  button.addEventListener('click', () => {
    const existing = getCenter()
    if (existing) {
      showPanel(propertyPanel, existing.element)
      status.textContent = 'build tasks: ready'
      return
    }

    const center = createBuildTaskCenter({
      apiClient,
      getTemplateId,
      onVersionActivated: () => {
        void reloadLatestVersion().catch((error: unknown) => {
          status.textContent = `tileset: unavailable (${formatError(error)})`
        })
      },
      onVersionPreview: previewVersion,
    })
    setCenter(center)
    showPanel(propertyPanel, center.element)
    status.textContent = 'build tasks: loading'
    void center.load()
      .then(() => {
        status.textContent = 'build tasks: ready'
      })
      .catch((error: unknown) => {
        showPanel(propertyPanel, renderEmptyPanel(`任务加载失败: ${formatError(error)}`))
        status.textContent = `build tasks: unavailable (${formatError(error)})`
        setCenter(undefined)
      })
  })
}

function installTemplateWorkbench(
  shell: HTMLElement,
  apiClient: ApiClient,
  status: HTMLElement,
  propertyPanel: HTMLElement,
  getWorkbench: () => TemplateWorkbench | undefined,
  setWorkbench: (workbench: TemplateWorkbench | undefined) => void,
  onTemplateSaved: Parameters<typeof createTemplateWorkbench>[0]['onTemplateSaved'],
): void {
  const button = requireElement<HTMLButtonElement>(shell, '[data-open-template-workbench]')
  button.addEventListener('click', () => {
    const existing = getWorkbench()
    if (existing) {
      showPanel(propertyPanel, existing.element)
      status.textContent = 'template: ready'
      return
    }

    const workbench = createTemplateWorkbench({
      apiClient,
      dataSourceId: 'local-qcwebserver',
      ...(onTemplateSaved === undefined ? {} : { onTemplateSaved }),
    })
    setWorkbench(workbench)
    showPanel(propertyPanel, workbench.element)
    status.textContent = 'template: loading'
    void workbench.load()
      .then(() => {
        status.textContent = 'template: ready'
      })
      .catch((error: unknown) => {
        showPanel(propertyPanel, renderEmptyPanel(`模板加载失败: ${formatError(error)}`))
        status.textContent = `template: unavailable (${formatError(error)})`
        setWorkbench(undefined)
      })
  })
}

async function loadVersionManifest(
  viewer: Viewer,
  apiClient: ApiClient,
  state: LayerState,
  status: HTMLElement,
  propertyPanel: HTMLElement,
  manifest: VersionManifest,
): Promise<LayerHandles> {
  const handles = await loadPipeNetworkLayers(viewer, manifest)
  status.textContent = `tileset: ${manifest.version}`
  void loadBuildReports(apiClient, manifest.version)
    .then(reports => showPanel(propertyPanel, renderBuildReportsPanel(reports)))
    .catch(() => {
      // The tileset is still usable when the optional summary is unavailable.
    })

  return handles
}

async function loadBuildReports(
  apiClient: ApiClient,
  version: string,
): Promise<Parameters<typeof renderBuildReportsPanel>[0]> {
  const quality = await apiClient.getQualityReport(version)
  const adaptation = await apiClient.getAdaptationReport(version).catch(() => null)
  return { quality, adaptation }
}

function installSearch(
  shell: HTMLElement,
  viewer: Viewer,
  apiClient: ApiClient,
  status: HTMLElement,
  propertyPanel: HTMLElement,
): void {
  const form = requireElement<HTMLFormElement>(shell, '[data-search-form]')
  const input = requireElement<HTMLInputElement>(shell, '[data-search-input]')
  const results = requireElement<HTMLElement>(shell, '[data-search-results]')

  form.addEventListener('submit', (event) => {
    event.preventDefault()
    const query = input.value.trim()
    results.replaceChildren()

    if (query === '') {
      hidePanel(propertyPanel)
      status.textContent = 'search: empty'
      return
    }

    status.textContent = 'search: loading'
    void apiClient.search(query)
      .then(searchResults => {
        renderSearchResults(results, searchResults, result => {
          if (result.longitude != null && result.latitude != null) {
            flyToSearchResult(viewer, result.longitude, result.latitude)
          }

          status.textContent = `search: ${result.type} ${result.id}`
          void loadSearchDetail(apiClient, result)
            .then(target => showPanel(propertyPanel, renderPropertyPanel(target)))
            .catch(error => showPanel(propertyPanel, renderEmptyPanel(`属性加载失败: ${formatError(error)}`)))
        })
        status.textContent = `search: ${searchResults.length} result${searchResults.length === 1 ? '' : 's'}`
      })
      .catch((error: unknown) => {
        results.replaceChildren()
        showPanel(propertyPanel, renderEmptyPanel(`搜索失败: ${formatError(error)}`))
        status.textContent = `search: unavailable (${formatError(error)})`
      })
  })
}

function renderSearchResults(
  container: HTMLElement,
  results: SearchResult[],
  onSelect: (result: SearchResult) => void,
): void {
  container.replaceChildren()

  if (results.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'qp3d-search-results__empty'
    empty.textContent = '无结果'
    container.append(empty)
    return
  }

  for (const result of results.slice(0, 8)) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'qp3d-search-result'
    button.addEventListener('click', () => onSelect(result))

    const label = document.createElement('span')
    label.textContent = result.label
    const meta = document.createElement('small')
    meta.textContent = result.type === 'line' ? '管线' : '管点'

    button.append(label, meta)
    container.append(button)
  }
}

async function loadSearchDetail(apiClient: ApiClient, result: SearchResult): Promise<PickTarget> {
  const detail = result.type === 'line'
    ? await apiClient.getLine(result.id)
    : await apiClient.getPoint(result.id)

  return {
    type: result.type,
    id: result.id,
    detail,
    metadata: {},
  }
}

function renderToolbar(shell: HTMLElement, state: LayerState, onChange: () => void): void {
  const pipeTypes = requireElement<HTMLElement>(shell, '[data-pipe-types]')
  const owners = requireElement<HTMLElement>(shell, '[data-owners]')
  const quality = requireElement<HTMLElement>(shell, '[data-quality]')
  const snapshot = state.snapshot()

  for (const pipeType of PIPE_TYPES) {
    pipeTypes.append(createCheckboxRow(pipeType, snapshot.pipeTypes[pipeType], checked => {
      state.setPipeTypeVisible(pipeType, checked)
      onChange()
    }))
  }

  for (const owner of OWNERS) {
    owners.append(createCheckboxRow(owner, snapshot.owners[owner], checked => {
      state.setOwnerVisible(owner, checked)
      onChange()
    }))
  }

  for (const qualityState of QUALITY_STATES) {
    const label = qualityState === 'normal' ? '正常' : '异常'
    quality.append(createCheckboxRow(label, snapshot.quality[qualityState], checked => {
      state.setQualityVisible(qualityState, checked)
      onChange()
    }))
  }
}

function createCheckboxRow(
  label: string,
  checked: boolean,
  onChange: (checked: boolean) => void,
): HTMLLabelElement {
  const row = document.createElement('label')
  row.className = 'qp3d-check-row'

  const input = document.createElement('input')
  input.type = 'checkbox'
  input.checked = checked
  input.addEventListener('change', () => onChange(input.checked))

  const text = document.createElement('span')
  text.textContent = label

  row.append(input, text)
  return row
}

function requireElement<T extends Element>(parent: ParentNode, selector: string): T {
  const element = parent.querySelector<T>(selector)
  if (!element) {
    throw new Error(`Missing required app element: ${selector}`)
  }

  return element
}

function showPanel(panel: HTMLElement, content: HTMLElement): void {
  panel.replaceChildren(content)
  panel.hidden = false
  panel.setAttribute('aria-hidden', 'false')
}

function hidePanel(panel: HTMLElement): void {
  panel.replaceChildren()
  panel.hidden = true
  panel.setAttribute('aria-hidden', 'true')
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
