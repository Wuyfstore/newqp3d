import './cesium/baseUrl'
import 'cesium/Build/Cesium/Widgets/widgets.css'

import { mountPipeNetworkApp } from './App'

const root = document.querySelector<HTMLElement>('#app')
if (!root) {
  throw new Error('Missing #app root element')
}

mountPipeNetworkApp(root)
