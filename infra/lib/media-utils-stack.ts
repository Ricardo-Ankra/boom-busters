import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Duration, RemovalPolicy, Size, Stack, Tags } from 'aws-cdk-lib'
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch'
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs'
import * as logs from 'aws-cdk-lib/aws-logs'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as sns from 'aws-cdk-lib/aws-sns'
import * as snsSubscriptions from 'aws-cdk-lib/aws-sns-subscriptions'
import type { StackProps } from 'aws-cdk-lib'
import type { Construct } from 'constructs'
import type { InfraConfig } from './config'

const here = path.dirname(fileURLToPath(import.meta.url))

/**
 * boom-busters-media-utils (build spec section 8): FFmpeg layer +
 * Whisper.cpp jobs — qc, loudnorm, transcribe, upload-youtube — invoked
 * asynchronously by the broker, completing via HMAC webhooks. Sized per
 * spec: 10,240 MB memory, 10 GB ephemeral storage, 15-minute timeout —
 * per-chapter transcription chunks keep every invocation comfortably
 * inside these limits.
 */
export class MediaUtilsStack extends Stack {
  readonly handler: nodejs.NodejsFunction
  readonly alertsTopic: sns.Topic

  constructor(scope: Construct, id: string, props: StackProps & { config: InfraConfig }) {
    super(scope, id, props)
    const { config } = props
    // Structural, not entry-point-dependent: the cost-allocation tag is part
    // of the stack itself (spec section 3).
    Tags.of(this).add('project', 'boom-busters')

    // Whisper.cpp binary + model live here; the Lambda pulls them to /tmp
    // on cold start (uploaded once by scripts/README instructions).
    const whisperAssets = new s3.Bucket(this, 'WhisperAssets', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: RemovalPolicy.RETAIN,
    })

    const ffmpegLayer = new lambda.LayerVersion(this, 'FfmpegLayer', {
      code: lambda.Code.fromAsset(path.join(here, '..', 'layers', 'ffmpeg')),
      compatibleRuntimes: [lambda.Runtime.NODEJS_20_X],
      description: 'Static ffmpeg at /opt/bin/ffmpeg (see layers/ffmpeg/README.md)',
    })

    const logGroup = new logs.LogGroup(this, 'HandlerLogs', {
      retention: logs.RetentionDays.THREE_MONTHS,
      removalPolicy: RemovalPolicy.DESTROY,
    })

    this.handler = new nodejs.NodejsFunction(this, 'Handler', {
      functionName: 'boom-busters-media-utils',
      entry: path.join(here, '..', 'lambdas', 'media-utils', 'handler.ts'),
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 10_240,
      ephemeralStorageSize: Size.gibibytes(10),
      timeout: Duration.minutes(15),
      layers: [ffmpegLayer],
      logGroup,
      environment: {
        BROKER_TOKEN: config.brokerToken,
        R2_ENDPOINT: config.r2.endpoint,
        R2_ACCESS_KEY_ID: config.r2.accessKeyId,
        R2_SECRET_ACCESS_KEY: config.r2.secretAccessKey,
        R2_BUCKET: config.r2.bucket,
        RENDER_BUCKET: 'remotionlambda-unset',
        WHISPER_BUCKET: whisperAssets.bucketName,
        WHISPER_BINARY_KEY: 'boom-busters/whisper/main',
        WHISPER_MODEL_KEY: 'boom-busters/whisper/ggml-base.en.bin',
        FFMPEG_PATH: '/opt/bin/ffmpeg',
      },
      bundling: {
        // The Node 20 runtime ships AWS SDK v3.
        externalModules: ['@aws-sdk/*'],
      },
    })

    whisperAssets.grantRead(this.handler)
    // Remotion's render buckets are created by its own deploy with a
    // versioned name; grant by the documented prefix.
    this.handler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject', 's3:PutObject', 's3:ListBucket'],
        resources: ['arn:aws:s3:::remotionlambda-*', 'arn:aws:s3:::remotionlambda-*/*'],
      }),
    )

    this.alertsTopic = new sns.Topic(this, 'Alerts', { topicName: 'boom-busters-alerts' })
    if (config.alertEmail !== undefined) {
      this.alertsTopic.addSubscription(new snsSubscriptions.EmailSubscription(config.alertEmail))
    }
    const notify = new cloudwatchActions.SnsAction(this.alertsTopic)

    const errors = new cloudwatch.Alarm(this, 'ErrorsAlarm', {
      alarmName: 'boom-busters-media-utils-errors',
      metric: this.handler.metricErrors({ period: Duration.minutes(5) }),
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    })
    errors.addAlarmAction(notify)

    const throttles = new cloudwatch.Alarm(this, 'ThrottlesAlarm', {
      alarmName: 'boom-busters-media-utils-throttles',
      metric: this.handler.metricThrottles({ period: Duration.minutes(5) }),
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    })
    throttles.addAlarmAction(notify)
  }
}
