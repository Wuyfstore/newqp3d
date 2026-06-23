import { describe, expect, it, vi } from 'vitest'

const baseLayer = { type: 'imagery-layer' }
const imageryProvider = { type: 'tms-provider' }

const buildModuleUrl = vi.fn((path: string) => `/cesium/${path}`)
const fromProviderAsync = vi.fn(() => baseLayer)
const fromUrl = vi.fn(async () => imageryProvider)
const directionalLightInstances: unknown[] = []
const DirectionalLight = vi.fn((options: unknown) => {
  const light = { type: 'directional-light', options }
  directionalLightInstances.push(light)
  return light
})
const Viewer = vi.fn(() => createViewerMock())

vi.mock('cesium', () => ({
  buildModuleUrl,
  Cartesian3: class {
    constructor(public x: number, public y: number, public z: number) {}
  },
  Color: {
    WHITE: 'white',
  },
  DirectionalLight,
  ImageryLayer: {
    fromProviderAsync,
  },
  TileMapServiceImageryProvider: {
    fromUrl,
  },
  Viewer,
}))

describe('createPipeNetworkViewer', () => {
  it('uses bundled Cesium assets and disables Ion-backed default imagery', async () => {
    const { createPipeNetworkViewer } = await import('../src/cesium/createViewer')
    const container = {} as HTMLElement

    createPipeNetworkViewer(container)

    expect(buildModuleUrl).toHaveBeenCalledWith('Assets/Textures/NaturalEarthII')
    expect(fromUrl).toHaveBeenCalledWith('/cesium/Assets/Textures/NaturalEarthII')
    expect(fromProviderAsync).toHaveBeenCalledWith(expect.any(Promise), {})
    expect(Viewer).toHaveBeenCalledWith(container, expect.objectContaining({
      baseLayer: baseLayer,
      baseLayerPicker: false,
      geocoder: false,
    }))
  })

  it('enables higher quality rendering to reduce jagged pipe edges', async () => {
    const viewer = createViewerMock()
    Viewer.mockReturnValueOnce(viewer)
    const { createPipeNetworkViewer } = await import('../src/cesium/createViewer')
    const container = {} as HTMLElement

    createPipeNetworkViewer(container)

    expect(Viewer).toHaveBeenCalledWith(container, expect.objectContaining({
      contextOptions: {
        webgl: expect.objectContaining({
          antialias: true,
          powerPreference: 'high-performance',
        }),
      },
      msaaSamples: 4,
      useBrowserRecommendedResolution: false,
    }))
    expect(viewer.scene.postProcessStages.fxaa.enabled).toBe(true)
    expect(viewer.resolutionScale).toBeGreaterThanOrEqual(1)
    expect(viewer.resolutionScale).toBeLessThanOrEqual(2)
  })

  it('uses a stable scene light for predictable PBR pipe shading', async () => {
    const viewer = createViewerMock()
    Viewer.mockReturnValueOnce(viewer)
    const { createPipeNetworkViewer } = await import('../src/cesium/createViewer')
    const container = {} as HTMLElement

    createPipeNetworkViewer(container)

    expect(DirectionalLight).toHaveBeenCalledWith({
      direction: expect.objectContaining({ x: -0.35, y: -0.45, z: -0.82 }),
      color: 'white',
      intensity: 2.2,
    })
    expect(viewer.scene.light).toBe(directionalLightInstances.at(-1))
    expect(viewer.scene.highDynamicRange).toBe(true)
  })
})

function createViewerMock() {
  return {
    scene: {
      highDynamicRange: false,
      light: undefined,
      postProcessStages: {
        fxaa: {
          enabled: false,
        },
      },
    },
    resolutionScale: 1,
  }
}
