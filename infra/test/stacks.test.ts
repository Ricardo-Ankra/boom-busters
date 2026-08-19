import { App } from 'aws-cdk-lib'
import { Match, Template } from 'aws-cdk-lib/assertions'
import { beforeAll, describe, expect, it } from 'vitest'
import { BrokerStack } from '../lib/broker-stack'
import { configFromEnv } from '../lib/config'
import { MediaUtilsStack } from '../lib/media-utils-stack'

/**
 * Template assertions: the stacks synthesise offline (asset bundling
 * skipped) and the properties the spec pins — sizes, tags, alarms, the
 * concurrency cap, lifecycle rules — are locked here so a refactor cannot
 * silently drop one.
 */

let broker: Template
let media: Template

beforeAll(() => {
  const app = new App({ context: { 'aws:cdk:bundling-stacks': [] } })
  const config = {
    ...configFromEnv({}),
    alertEmail: 'alerts@example.com',
    remotion: { functionName: 'remotion-render-4-0-512-test', serveUrl: 'https://site.example' },
    renderBucket: 'remotionlambda-test',
  }
  const mediaStack = new MediaUtilsStack(app, 'boom-busters-media-utils', { config })
  const brokerStack = new BrokerStack(app, 'boom-busters-broker', {
    config,
    mediaUtilsFunction: mediaStack.handler,
    alertsTopic: mediaStack.alertsTopic,
  })
  media = Template.fromStack(mediaStack)
  broker = Template.fromStack(brokerStack)
  // Synthesising two stacks is tens of seconds under a loaded machine;
  // vitest's 10 s default hook timeout flakes when the full suite runs.
}, 120_000)

describe('media-utils stack', () => {
  it('hands the Lambda the configured Remotion render bucket, not a placeholder', () => {
    media.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'boom-busters-media-utils',
      Environment: { Variables: Match.objectLike({ RENDER_BUCKET: 'remotionlambda-test' }) },
    })
  })

  it('sizes the Lambda per spec section 8: 10240 MB, 10 GB disk, 15 min', () => {
    media.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'boom-busters-media-utils',
      MemorySize: 10_240,
      Timeout: 900,
      EphemeralStorage: { Size: 10_240 },
    })
  })

  it('tags every resource project=boom-busters (cost allocation)', () => {
    media.hasResourceProperties('AWS::Lambda::Function', {
      Tags: Match.arrayWith([{ Key: 'project', Value: 'boom-busters' }]),
    })
  })

  it('ships the ffmpeg layer and the alerts topic with an email subscriber', () => {
    media.resourceCountIs('AWS::Lambda::LayerVersion', 1)
    media.hasResourceProperties('AWS::SNS::Topic', { TopicName: 'boom-busters-alerts' })
    media.hasResourceProperties('AWS::SNS::Subscription', {
      Protocol: 'email',
      Endpoint: 'alerts@example.com',
    })
  })

  it('alarms on errors and throttles', () => {
    media.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'boom-busters-media-utils-errors',
    })
    media.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'boom-busters-media-utils-throttles',
    })
  })
})

describe('broker stack', () => {
  it('exposes a function URL with app-level (bearer) auth only', () => {
    broker.hasResourceProperties('AWS::Lambda::Url', { AuthType: 'NONE' })
  })

  it('carries the render cap into the environment', () => {
    broker.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'boom-busters-broker',
      Environment: { Variables: Match.objectLike({ RENDER_CAP: '2' }) },
    })
  })

  it('expires renders after 90 days and broker state after 180 (section 12)', () => {
    broker.hasResourceProperties('AWS::S3::Bucket', {
      LifecycleConfiguration: {
        Rules: Match.arrayWith([
          Match.objectLike({ Prefix: 'renders/', ExpirationInDays: 90 }),
          Match.objectLike({ Prefix: 'broker/', ExpirationInDays: 180 }),
        ]),
      },
    })
  })

  it('alarms on errors, 5xx, signature failures and cap-busting concurrency', () => {
    for (const name of [
      'boom-busters-broker-errors',
      'boom-busters-broker-5xx',
      'boom-busters-broker-signature-failures',
      'boom-busters-render-concurrency',
    ]) {
      broker.hasResourceProperties('AWS::CloudWatch::Alarm', { AlarmName: name })
    }
  })

  it('watches the RENDER function for concurrency above the cap of 2', () => {
    broker.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'boom-busters-render-concurrency',
      Threshold: 2,
      Dimensions: Match.arrayWith([
        Match.objectLike({ Name: 'FunctionName', Value: 'remotion-render-4-0-512-test' }),
      ]),
    })
  })

  it('guards daily spend with an AWS budget emailing the owner', () => {
    broker.hasResourceProperties('AWS::Budgets::Budget', {
      Budget: Match.objectLike({
        BudgetName: 'boom-busters-daily-spend',
        TimeUnit: 'DAILY',
        BudgetLimit: { Amount: 25, Unit: 'USD' },
      }),
    })
  })

  it('may invoke only Remotion render functions and media-utils', () => {
    const policies = broker.findResources('AWS::IAM::Policy')
    const statements = Object.values(policies).flatMap(
      (policy) =>
        (policy['Properties'] as { PolicyDocument: { Statement: unknown[] } }).PolicyDocument
          .Statement,
    )
    const invokeResources = statements
      .filter((statement) =>
        JSON.stringify((statement as { Action: unknown }).Action).includes('InvokeFunction'),
      )
      .map((statement) => JSON.stringify((statement as { Resource: unknown }).Resource))
    expect(invokeResources.length).toBeGreaterThan(0)
    for (const resource of invokeResources) {
      expect(resource).toMatch(/remotion-render-|boom-busters-media-utils|GetAtt/)
    }
  })
})
