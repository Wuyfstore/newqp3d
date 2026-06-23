import { Axis, Cesium3DTileset, type Viewer } from 'cesium'

import { createFlowMaterialShader, createPipeNetworkStyle } from './styles'
import type { LayerStateSnapshot } from '../state/layerState'

export interface VersionManifest {
  version: string
  tilesetUrl: string
  flowMode?: 'embedded'
  flowTilesetUrl?: string
  metadataUrl?: string
  qualityReportUrl?: string
}

export interface LayerHandles {
  pipeNetworkTileset: Cesium3DTileset
  flowTileset?: Cesium3DTileset
  applyState(snapshot: LayerStateSnapshot): void
  destroy(): void
}

export async function loadPipeNetworkLayers(
  viewer: Viewer,
  manifest: VersionManifest,
): Promise<LayerHandles> {
  const flowShader = manifest.flowMode === 'embedded' ? createFlowMaterialShader() : undefined
  const pipeNetworkTileset = await Cesium3DTileset.fromUrl(manifest.tilesetUrl, {
    modelUpAxis: Axis.Z,
  })
  if (flowShader)
    pipeNetworkTileset.customShader = flowShader
  viewer.scene.primitives.add(pipeNetworkTileset)
  await viewer.zoomTo(pipeNetworkTileset)
  const stopFlowAnimation = flowShader ? startFlowAnimation(flowShader, viewer) : () => undefined

  const handles: LayerHandles = {
    pipeNetworkTileset,
    applyState(snapshot) {
      pipeNetworkTileset.show = hasAnyVisibleFilter(snapshot)
      pipeNetworkTileset.style = createPipeNetworkStyle(snapshot)
      viewer.scene.requestRender()
    },
    destroy() {
      stopFlowAnimation()
      viewer.scene.primitives.remove(pipeNetworkTileset)
      destroyCustomShader(flowShader)
    },
  }

  return handles
}

function hasAnyVisibleFilter(snapshot: LayerStateSnapshot): boolean {
  return Object.values(snapshot.quality).some(Boolean)
}

function startFlowAnimation(flowShader: ReturnType<typeof createFlowMaterialShader>, viewer: Viewer): () => void {
  const startedAt = globalThis.performance?.now?.() ?? Date.now()
  const removeListener = viewer.scene.postRender.addEventListener(() => {
    const now = globalThis.performance?.now?.() ?? Date.now()
    flowShader.setUniform('u_time', (now - startedAt) / 1000)
    viewer.scene.requestRender()
  })

  return removeListener
}

function destroyCustomShader(flowShader: ReturnType<typeof createFlowMaterialShader> | undefined): void {
  const maybeDestroy = flowShader as (ReturnType<typeof createFlowMaterialShader> & { destroy?: () => void }) | undefined
  maybeDestroy?.destroy?.()
}
