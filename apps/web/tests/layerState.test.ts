import { describe, expect, it } from 'vitest'
import { createLayerState } from '../src/state/layerState'

describe('layer state', () => {
  it('tracks pipe type and owner filters without recreating tilesets', () => {
    const state = createLayerState()
    state.setPipeTypeVisible('雨水管', false)
    state.setOwnerVisible('小区', false)

    expect(state.snapshot()).toEqual({
      pipeTypes: { 雨水管: false, 污水管: true, 合流管: true },
      owners: { 市政: true, 小区: false, 农村: true },
      quality: { normal: true, abnormal: true },
      underground: { enabled: false, terrainAlpha: 1, verticalExaggeration: 1 },
    })
  })
})
