import { Config } from '@remotion/cli/config'
import { webpackOverride } from './src/webpack-override'

// `pnpm --filter @boom-busters/compositions studio` opens the fixture
// gallery for visual development (build spec section 8.3: every component
// gets a Studio fixture).
Config.setEntryPoint('src/studio.ts')
Config.overrideWebpackConfig(webpackOverride)
