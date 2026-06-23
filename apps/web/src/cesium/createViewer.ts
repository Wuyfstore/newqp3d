import {
  buildModuleUrl,
  Cartesian3,
  Color,
  DirectionalLight,
  ImageryLayer,
  TileMapServiceImageryProvider,
  Viewer,
} from 'cesium'

export function createPipeNetworkViewer(container: HTMLElement): Viewer {
  const baseLayer = ImageryLayer.fromProviderAsync(
    TileMapServiceImageryProvider.fromUrl(
      buildModuleUrl('Assets/Textures/NaturalEarthII'),
    ),
    {},
  )

  const viewer = new Viewer(container, {
    animation: false,
    timeline: false,
    baseLayer,
    baseLayerPicker: false,
    contextOptions: {
      webgl: {
        antialias: true,
        powerPreference: 'high-performance',
      },
    },
    geocoder: false,
    homeButton: true,
    sceneModePicker: true,
    navigationHelpButton: false,
    infoBox: false,
    msaaSamples: 4,
    selectionIndicator: false,
    useBrowserRecommendedResolution: false,
  })

  viewer.resolutionScale = Math.min(globalThis.devicePixelRatio || 1, 2)
  viewer.scene.highDynamicRange = true
  viewer.scene.light = new DirectionalLight({
    direction: new Cartesian3(-0.35, -0.45, -0.82),
    color: Color.WHITE,
    intensity: 2.2,
  })
  viewer.scene.postProcessStages.fxaa.enabled = true

  return viewer
}
