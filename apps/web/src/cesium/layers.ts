import { Cesium3DTileset, type Viewer } from 'cesium'

import { createPipeNetworkStyle } from './styles'
import type { LayerStateSnapshot } from '../state/layerState'

export interface VersionManifest {
  version: string
  tilesetUrl: string
  metadataUrl?: string
  qualityReportUrl?: string
}

export interface LayerHandles {
  pipeNetworkTileset: Cesium3DTileset
  applyState(snapshot: LayerStateSnapshot): void
  destroy(): void
}

export async function loadPipeNetworkLayers(
  viewer: Viewer,
  manifest: VersionManifest,
): Promise<LayerHandles> {
  const pipeNetworkTileset = await Cesium3DTileset.fromUrl(manifest.tilesetUrl)
  viewer.scene.primitives.add(pipeNetworkTileset)
  await viewer.zoomTo(pipeNetworkTileset)

  return {
    pipeNetworkTileset,
    applyState(snapshot) {
      pipeNetworkTileset.show = hasAnyVisibleFilter(snapshot)
      pipeNetworkTileset.style = createPipeNetworkStyle(snapshot)
      viewer.scene.requestRender()
    },
    destroy() {
      viewer.scene.primitives.remove(pipeNetworkTileset)
    },
  }
}

function hasAnyVisibleFilter(snapshot: LayerStateSnapshot): boolean {
  return Object.values(snapshot.pipeTypes).some(Boolean)
    && Object.values(snapshot.owners).some(Boolean)
    && Object.values(snapshot.quality).some(Boolean)
}
