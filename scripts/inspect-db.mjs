import { loadPipelineConfig } from '../packages/pipeline/dist/config.js'
import { PostgisDataSource } from '../packages/pipeline/dist/datasource/postgis.js'

const config = loadPipelineConfig(process.env)
const source = new PostgisDataSource(config)
const inspection = await source.inspect()

console.log(JSON.stringify(inspection, null, 2))
