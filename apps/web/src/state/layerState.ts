export const PIPE_TYPES = ['雨水管', '污水管', '合流管'] as const
export const OWNERS = ['市政', '小区', '农村'] as const
export const QUALITY_STATES = ['normal', 'abnormal'] as const

export type PipeType = typeof PIPE_TYPES[number]
export type Owner = typeof OWNERS[number]
export type QualityState = typeof QUALITY_STATES[number]

export interface UndergroundState {
  enabled: boolean
  terrainAlpha: number
  verticalExaggeration: number
}

export interface LayerStateSnapshot {
  pipeTypes: Record<PipeType, boolean>
  owners: Record<Owner, boolean>
  quality: Record<QualityState, boolean>
  underground: UndergroundState
}

export interface LayerState {
  setPipeTypeVisible(pipeType: PipeType, visible: boolean): void
  setOwnerVisible(owner: Owner, visible: boolean): void
  setQualityVisible(quality: QualityState, visible: boolean): void
  setUndergroundEnabled(enabled: boolean): void
  setTerrainAlpha(terrainAlpha: number): void
  setVerticalExaggeration(verticalExaggeration: number): void
  snapshot(): LayerStateSnapshot
}

export function createLayerState(): LayerState {
  let current: LayerStateSnapshot = {
    pipeTypes: { 雨水管: true, 污水管: true, 合流管: true },
    owners: { 市政: true, 小区: true, 农村: true },
    quality: { normal: true, abnormal: true },
    underground: { enabled: false, terrainAlpha: 1, verticalExaggeration: 1 },
  }

  const replace = (next: LayerStateSnapshot): void => {
    current = next
  }

  return {
    setPipeTypeVisible(pipeType, visible) {
      replace({
        ...current,
        pipeTypes: { ...current.pipeTypes, [pipeType]: visible },
      })
    },
    setOwnerVisible(owner, visible) {
      replace({
        ...current,
        owners: { ...current.owners, [owner]: visible },
      })
    },
    setQualityVisible(quality, visible) {
      replace({
        ...current,
        quality: { ...current.quality, [quality]: visible },
      })
    },
    setUndergroundEnabled(enabled) {
      replace({
        ...current,
        underground: { ...current.underground, enabled },
      })
    },
    setTerrainAlpha(terrainAlpha) {
      replace({
        ...current,
        underground: { ...current.underground, terrainAlpha },
      })
    },
    setVerticalExaggeration(verticalExaggeration) {
      replace({
        ...current,
        underground: { ...current.underground, verticalExaggeration },
      })
    },
    snapshot() {
      return {
        pipeTypes: { ...current.pipeTypes },
        owners: { ...current.owners },
        quality: { ...current.quality },
        underground: { ...current.underground },
      }
    },
  }
}
