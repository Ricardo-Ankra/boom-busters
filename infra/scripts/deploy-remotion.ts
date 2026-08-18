import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { deployFunction, deploySite, getOrCreateBucket } from '@remotion/lambda'
import { webpackOverride } from '@boom-busters/compositions/webpack-override'

/**
 * Deploys the Remotion Lambda render function and the compositions site
 * (spec section 8). Run AFTER `cdk deploy` with AWS credentials for the
 * Reelscript account:
 *
 *   AWS_REGION=eu-west-1 pnpm --filter @boom-busters/infra deploy:remotion
 *
 * Remotion names its function by version and resources — the name printed
 * here goes into REMOTION_FUNCTION_NAME / REMOTION_SERVE_URL for the next
 * `cdk deploy` (decision 133: 'boom-busters-render' is the logical name;
 * the physical name is Remotion's, tagged project=boom-busters).
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const region = (process.env['AWS_REGION'] ?? 'eu-west-1') as never

async function main() {
  const { functionName, alreadyExisted } = await deployFunction({
    region,
    createCloudWatchLogGroup: true,
    memorySizeInMb: 2048,
    diskSizeInMb: 10_240,
    timeoutInSeconds: 240,
  })
  console.log(`function: ${functionName}${alreadyExisted ? ' (already deployed)' : ''}`)

  const { bucketName } = await getOrCreateBucket({ region })
  const { serveUrl } = await deploySite({
    region,
    bucketName,
    siteName: 'boom-busters-compositions',
    entryPoint: path.join(here, '..', '..', 'packages', 'compositions', 'src', 'studio.ts'),
    options: { webpackOverride },
  })
  console.log(`site: ${serveUrl}`)

  console.log('\nExport these before the next cdk deploy:')
  console.log(`  REMOTION_FUNCTION_NAME=${functionName}`)
  console.log(`  REMOTION_SERVE_URL=${serveUrl}`)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
