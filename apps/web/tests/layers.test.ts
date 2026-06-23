import { beforeEach, describe, expect, it, vi } from 'vitest'

function makeTileset() {
  return { show: true, style: undefined as unknown, customShader: undefined as unknown }
}

const tileset = makeTileset()
const flowTileset = makeTileset()
const fromUrl = vi.fn(async (url: string) => url.includes('/flow/') ? flowTileset : tileset)
const add = vi.fn()
const remove = vi.fn()
const requestRender = vi.fn()
const zoomTo = vi.fn()
const removePostRenderListener = vi.fn()
const addPostRenderListener = vi.fn((_listener: () => void): (() => void) => removePostRenderListener)
const setUniform = vi.fn()
const flowShader = {
  options: {
    uniforms: {
      u_time: { type: 'float', value: 0 },
    },
    fragmentShaderText: 'fsInput.attributes.texCoord_0.x',
  },
  setUniform,
}
const CustomShader = vi.fn(function CustomShader(this: { options: unknown, setUniform: typeof setUniform }, options: unknown) {
  this.options = options
  this.setUniform = setUniform
})

vi.mock('cesium', () => ({
  Axis: {
    X: 0,
    Y: 1,
    Z: 2,
  },
  CustomShader,
  CustomShaderMode: {
    MODIFY_MATERIAL: 'MODIFY_MATERIAL',
  },
  Cesium3DTileset: {
    fromUrl,
  },
  UniformType: {
    FLOAT: 'float',
  },
}))

vi.mock('../src/cesium/styles', () => ({
  createPipeNetworkStyle: vi.fn(() => ({ color: 'style' })),
  createFlowMaterialShader: vi.fn(() => flowShader),
}))

describe('loadPipeNetworkLayers', () => {
  beforeEach(() => {
    tileset.show = true
    tileset.style = undefined
    tileset.customShader = undefined
    flowTileset.show = true
    flowTileset.style = undefined
    flowTileset.customShader = undefined
    fromUrl.mockClear()
    add.mockClear()
    remove.mockClear()
    requestRender.mockClear()
    zoomTo.mockClear()
    addPostRenderListener.mockClear()
    removePostRenderListener.mockClear()
    setUniform.mockClear()
    CustomShader.mockClear()
  })

  it('loads ENU pipe meshes as Z-up 3D Tiles content', async () => {
    const { loadPipeNetworkLayers } = await import('../src/cesium/layers')
    const viewer = {
      scene: {
        primitives: { add, remove },
        postRender: { addEventListener: addPostRenderListener },
        requestRender,
      },
      zoomTo,
    }

    await loadPipeNetworkLayers(viewer as never, {
      version: 'network-test',
      tilesetUrl: '/tiles/network-test/tileset.json',
    })

    expect(fromUrl).toHaveBeenCalledWith('/tiles/network-test/tileset.json', {
      modelUpAxis: 2,
    })
    expect(add).toHaveBeenCalledWith(tileset)
    expect(zoomTo).toHaveBeenCalledWith(tileset)
  })

  it('does not hide the whole tileset when temporary pipe and owner filters are unchecked', async () => {
    const { loadPipeNetworkLayers } = await import('../src/cesium/layers')
    const viewer = {
      scene: {
        primitives: { add, remove },
        postRender: { addEventListener: addPostRenderListener },
        requestRender,
      },
      zoomTo,
    }

    const handles = await loadPipeNetworkLayers(viewer as never, {
      version: 'network-test',
      tilesetUrl: '/tiles/network-test/tileset.json',
    })
    handles.applyState({
      pipeTypes: { 雨水管: false, 污水管: false, 合流管: false },
      owners: { 市政: false, 小区: false, 农村: false },
      quality: { normal: true, abnormal: true },
      underground: { enabled: false, terrainAlpha: 1, verticalExaggeration: 1 },
    })

    expect(tileset.show).toBe(true)
  })

  it('applies embedded flow shader to the main tileset without loading an overlay tileset', async () => {
    const { loadPipeNetworkLayers } = await import('../src/cesium/layers')
    const viewer = {
      scene: {
        primitives: { add, remove },
        postRender: { addEventListener: addPostRenderListener },
        requestRender,
      },
      zoomTo,
    }

    const handles = await loadPipeNetworkLayers(viewer as never, {
      version: 'network-test',
      tilesetUrl: '/tiles/network-test/tileset.json',
      flowMode: 'embedded',
    })
    handles.applyState({
      pipeTypes: { 雨水管: true, 污水管: true, 合流管: true },
      owners: { 市政: true, 小区: true, 农村: true },
      quality: { normal: true, abnormal: true },
      underground: { enabled: false, terrainAlpha: 1, verticalExaggeration: 1 },
    })

    expect(fromUrl).toHaveBeenCalledTimes(1)
    expect(add).not.toHaveBeenCalledWith(flowTileset)
    expect(handles.flowTileset).toBeUndefined()
    expect(tileset.customShader).toEqual(expect.objectContaining({
      options: expect.objectContaining({
        uniforms: expect.objectContaining({
          u_time: expect.objectContaining({ type: 'float' }),
        }),
        fragmentShaderText: expect.stringContaining('fsInput.attributes.texCoord_0.x'),
      }),
      setUniform,
    }))
    expect(addPostRenderListener).toHaveBeenCalledTimes(1)
    const onPostRender = addPostRenderListener.mock.calls[0]![0] as () => void
    onPostRender()
    expect(setUniform).toHaveBeenCalledWith('u_time', expect.any(Number))
    handles.destroy()
    expect(removePostRenderListener).toHaveBeenCalledTimes(1)
    expect(remove).toHaveBeenCalledWith(tileset)
  })
})
