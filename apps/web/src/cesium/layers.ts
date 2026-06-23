import {
  Axis,
  BoundingSphere,
  Cartesian3,
  Cesium3DTileset,
  HeadingPitchRange,
  Math as CesiumMath,
  Matrix4,
  type Viewer,
} from 'cesium'

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
  await flyToInitialContentFocus(viewer, manifest.tilesetUrl, pipeNetworkTileset)
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

async function flyToInitialContentFocus(
  viewer: Viewer,
  tilesetUrl: string,
  fallbackTileset: Cesium3DTileset,
): Promise<void> {
  const focus = await loadInitialContentFocus(tilesetUrl).catch(() => undefined)
  if (!focus) {
    await viewer.zoomTo(fallbackTileset)
    return
  }

  await viewer.camera.flyToBoundingSphere(focus, {
    duration: 0,
    offset: new HeadingPitchRange(0, CesiumMath.toRadians(-65), Math.max(focus.radius * 2.4, 1200)),
  })
}

async function loadInitialContentFocus(tilesetUrl: string): Promise<BoundingSphere | undefined> {
  const response = await fetch(tilesetUrl)
  if (!response.ok)
    return undefined

  const tileset = await response.json() as TilesetJson
  const root = tileset.root
  if (!root)
    return undefined

  const tile = selectInitialTile(root)
  const box = tile?.boundingVolume?.box
  if (!box)
    return undefined

  const localCenter = new Cartesian3(box[0], box[1], box[2])
  const center = root.transform
    ? Matrix4.multiplyByPoint(Matrix4.fromArray(root.transform), localCenter, new Cartesian3())
    : localCenter
  const radius = Math.hypot(box[3], box[7], box[11])

  return new BoundingSphere(center, Math.max(radius, 1))
}

function selectInitialTile(root: TilesetTileJson): TilesetTileJson | undefined {
  const contentTiles = flattenTiles(root)
    .filter(tile => tile.content?.uri && tile.boundingVolume?.box)
    .sort((left, right) => tileRadius(left) - tileRadius(right))

  return contentTiles[Math.floor(contentTiles.length / 2)] ?? root
}

function flattenTiles(tile: TilesetTileJson): TilesetTileJson[] {
  return [tile, ...(tile.children ?? []).flatMap(flattenTiles)]
}

function tileRadius(tile: TilesetTileJson): number {
  const box = tile.boundingVolume?.box
  return box ? Math.hypot(box[3], box[7], box[11]) : Number.POSITIVE_INFINITY
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

interface TilesetJson {
  root?: TilesetTileJson
}

interface TilesetTileJson {
  boundingVolume?: {
    box?: [number, number, number, number, number, number, number, number, number, number, number, number]
  }
  transform?: number[]
  content?: {
    uri?: string
  }
  children?: TilesetTileJson[]
}
