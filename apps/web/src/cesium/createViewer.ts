import { Viewer } from 'cesium'

export function createPipeNetworkViewer(container: HTMLElement): Viewer {
  return new Viewer(container, {
    animation: false,
    timeline: false,
    baseLayerPicker: true,
    geocoder: false,
    homeButton: true,
    sceneModePicker: true,
    navigationHelpButton: false,
    infoBox: false,
    selectionIndicator: false,
  })
}
