import {
  Cartesian3,
  Color,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  type Viewer,
} from 'cesium'

import type { ApiClient, PipeLineDetail, PipePointDetail } from '../services/apiClient'

export interface PickTarget {
  type: 'line' | 'point'
  id: string
  detail: PipeLineDetail | PipePointDetail
  metadata: Record<string, unknown>
}

export interface PickingCallbacks {
  onPickStart?(): void
  onPick(target: PickTarget): void
  onPickMiss?(): void
  onPickError?(error: unknown): void
}

type HighlightableFeature = {
  color: Color
  getProperty?(name: string): unknown
  getPropertyIds?(results?: string[]): string[]
  featureId?: number
}

const HIGHLIGHT_COLOR = Color.YELLOW.withAlpha(0.85)
const LINE_ID_KEYS = ['guid', 'GUID', 'id', 'lineId', 'LINE_ID']
const POINT_ID_KEYS = ['gdbm', 'GDBM', 'pointId', 'POINT_ID']
const TYPE_KEYS = ['type', 'featureType', 'kind', 'layer', 'layerType']

export function installPicking(
  viewer: Viewer,
  apiClient: ApiClient,
  callbacks: PickingCallbacks,
): () => void {
  const handler = new ScreenSpaceEventHandler(viewer.scene.canvas)
  let highlighted: { feature: HighlightableFeature, color: Color } | undefined
  let pickSequence = 0

  const clearHighlight = (): void => {
    if (!highlighted) {
      return
    }

    highlighted.feature.color = highlighted.color
    highlighted = undefined
    viewer.scene.requestRender()
  }

  const setHighlight = (feature: HighlightableFeature): void => {
    if (highlighted?.feature === feature) {
      return
    }

    clearHighlight()
    highlighted = { feature, color: Color.clone(feature.color) }
    feature.color = Color.clone(HIGHLIGHT_COLOR)
    viewer.scene.requestRender()
  }

  handler.setInputAction((movement: ScreenSpaceEventHandler.PositionedEvent) => {
    const currentPick = ++pickSequence
    callbacks.onPickStart?.()
    const picked = viewer.scene.pick(movement.position)
    const feature = asHighlightableFeature(picked)
    const metadata = feature ? readFeatureMetadata(feature) : {}
    const identity = resolvePickIdentity(metadata)

    if (!feature || !identity) {
      clearHighlight()
      callbacks.onPickMiss?.()
      return
    }

    setHighlight(feature)
    void loadPickTarget(apiClient, identity, metadata)
      .then((target) => {
        if (currentPick === pickSequence) {
          callbacks.onPick(target)
        }
      })
      .catch((error: unknown) => {
        if (currentPick === pickSequence) {
          clearHighlight()
          callbacks.onPickError?.(error)
        }
      })
  }, ScreenSpaceEventType.LEFT_CLICK)

  return () => {
    clearHighlight()
    handler.destroy()
  }
}

export function flyToSearchResult(viewer: Viewer, longitude: number, latitude: number): void {
  void viewer.camera.flyTo({
    destination: Cartesian3.fromDegrees(longitude, latitude, 900),
  })
}

async function loadPickTarget(
  apiClient: ApiClient,
  identity: { type: 'line' | 'point', id: string },
  metadata: Record<string, unknown>,
): Promise<PickTarget> {
  const detail = identity.type === 'line'
    ? await apiClient.getLine(identity.id)
    : await apiClient.getPoint(identity.id)

  return {
    ...identity,
    detail,
    metadata,
  }
}

function asHighlightableFeature(value: unknown): HighlightableFeature | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  const candidate = value as Partial<HighlightableFeature>
  if (candidate.color instanceof Color) {
    return candidate as HighlightableFeature
  }

  return undefined
}

function readFeatureMetadata(feature: HighlightableFeature): Record<string, unknown> {
  const metadata: Record<string, unknown> = {}
  const propertyIds = typeof feature.getPropertyIds === 'function' ? feature.getPropertyIds() : []

  for (const propertyId of propertyIds) {
    metadata[propertyId] = feature.getProperty?.(propertyId)
  }

  for (const key of [...LINE_ID_KEYS, ...POINT_ID_KEYS, ...TYPE_KEYS]) {
    if (metadata[key] == null) {
      const value = feature.getProperty?.(key)
      if (value != null) {
        metadata[key] = value
      }
    }
  }

  if (feature.featureId != null && metadata.featureId == null) {
    metadata.featureId = feature.featureId
  }

  return metadata
}

function resolvePickIdentity(metadata: Record<string, unknown>): { type: 'line' | 'point', id: string } | undefined {
  const explicitType = readString(metadata, TYPE_KEYS)?.toLowerCase()
  const lineId = readString(metadata, LINE_ID_KEYS)
  const pointId = readString(metadata, POINT_ID_KEYS)

  if (explicitType?.includes('point') && pointId) {
    return { type: 'point', id: pointId }
  }

  if (explicitType?.includes('line') && lineId) {
    return { type: 'line', id: lineId }
  }

  if (pointId) {
    return { type: 'point', id: pointId }
  }

  if (lineId) {
    return { type: 'line', id: lineId }
  }

  return undefined
}

function readString(metadata: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = metadata[key]
    if (typeof value === 'string' && value.trim() !== '') {
      return value
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value)
    }
  }

  return undefined
}
