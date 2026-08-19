import { App, Tags } from 'aws-cdk-lib'
import { BrokerStack } from '../lib/broker-stack'
import { configFromEnv } from '../lib/config'
import { MediaUtilsStack } from '../lib/media-utils-stack'

/**
 * The infra app (build spec sections 3 and 8): two stacks into the existing
 * Reelscript AWS account, every resource tagged `project=boom-busters` so
 * cost allocation can split this project from the rest of the account.
 * Deploy prerequisites and the Remotion function/site deploy are in
 * infra/README.md.
 */
const app = new App()
Tags.of(app).add('project', 'boom-busters')

const config = configFromEnv()

const mediaUtils = new MediaUtilsStack(app, 'boom-busters-media-utils', { config })
new BrokerStack(app, 'boom-busters-broker', {
  config,
  mediaUtilsFunction: mediaUtils.handler,
  alertsTopic: mediaUtils.alertsTopic,
})
