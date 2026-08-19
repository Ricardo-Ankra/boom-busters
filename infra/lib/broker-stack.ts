import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CfnOutput, Duration, RemovalPolicy, Stack, Tags } from 'aws-cdk-lib'
import * as budgets from 'aws-cdk-lib/aws-budgets'
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch'
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs'
import * as logs from 'aws-cdk-lib/aws-logs'
import * as s3 from 'aws-cdk-lib/aws-s3'
import type { StackProps } from 'aws-cdk-lib'
import type { Construct } from 'constructs'
import type * as sns from 'aws-cdk-lib/aws-sns'
import type { InfraConfig } from './config'

const here = path.dirname(fileURLToPath(import.meta.url))

/**
 * boom-busters-broker (build spec section 8): the bearer-token Lambda URL in
 * front of Remotion Lambda and media-utils — render start with URL
 * materialisation, tombstone cancel (8.1), progress proxy, webhook
 * normalisation, media-job dispatch. Alarms per section 12: errors, 5xx,
 * signature failures (possible probe), render concurrency above the cap,
 * and a daily AWS budget with email notification.
 */
export class BrokerStack extends Stack {
  readonly handler: nodejs.NodejsFunction
  readonly url: lambda.FunctionUrl

  constructor(
    scope: Construct,
    id: string,
    props: StackProps & {
      config: InfraConfig
      mediaUtilsFunction: lambda.IFunction
      alertsTopic: sns.ITopic
    },
  ) {
    super(scope, id, props)
    const { config } = props
    // Structural, not entry-point-dependent: the cost-allocation tag is part
    // of the stack itself (spec section 3).
    Tags.of(this).add('project', 'boom-busters')

    // Render state, tombstones and materialised timeline copies. Lifecycle
    // per section 12: renders expire after 90 days; broker state after 180.
    const stateBucket = new s3.Bucket(this, 'State', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: RemovalPolicy.RETAIN,
      lifecycleRules: [
        { prefix: 'renders/', expiration: Duration.days(90) },
        { prefix: 'broker/', expiration: Duration.days(180) },
      ],
    })

    const logGroup = new logs.LogGroup(this, 'HandlerLogs', {
      retention: logs.RetentionDays.THREE_MONTHS,
      removalPolicy: RemovalPolicy.DESTROY,
    })

    this.handler = new nodejs.NodejsFunction(this, 'Handler', {
      functionName: 'boom-busters-broker',
      entry: path.join(here, '..', 'lambdas', 'broker', 'handler.ts'),
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 1024,
      timeout: Duration.minutes(2),
      logGroup,
      environment: {
        BROKER_TOKEN: config.brokerToken,
        CALLBACK_URL: config.callbackUrl,
        STATE_BUCKET: stateBucket.bucketName,
        R2_ENDPOINT: config.r2.endpoint,
        R2_ACCESS_KEY_ID: config.r2.accessKeyId,
        R2_SECRET_ACCESS_KEY: config.r2.secretAccessKey,
        R2_BUCKET: config.r2.bucket,
        REMOTION_FUNCTION_NAME: config.remotion.functionName,
        REMOTION_SERVE_URL: config.remotion.serveUrl,
        MEDIA_UTILS_FUNCTION_NAME: props.mediaUtilsFunction.functionName,
        RENDER_CAP: String(config.renderCap),
      },
      bundling: {
        externalModules: ['@aws-sdk/*'],
        // ESM output: @remotion/lambda calls createRequire(import.meta.url)
        // at module scope, which esbuild's CJS output rewrites to undefined —
        // the function then dies at init. The banner is Remotion's documented
        // companion so bundled CJS dependencies can still require().
        format: nodejs.OutputFormat.ESM,
        banner:
          "import { createRequire as topLevelCreateRequire } from 'node:module'; const require = topLevelCreateRequire(import.meta.url);",
      },
    })

    stateBucket.grantReadWrite(this.handler)
    props.mediaUtilsFunction.grantInvoke(this.handler)
    // Remotion's own function and buckets carry versioned names; grant by
    // the documented prefixes (this is what Remotion's policy guide does).
    this.handler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['lambda:InvokeFunction'],
        resources: [`arn:aws:lambda:*:*:function:remotion-render-*`],
      }),
    )
    this.handler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject', 's3:ListBucket'],
        resources: ['arn:aws:s3:::remotionlambda-*', 'arn:aws:s3:::remotionlambda-*/*'],
      }),
    )

    // Bearer auth is enforced in the handler; the URL itself is open.
    this.url = this.handler.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
    })
    new CfnOutput(this, 'BrokerUrl', { value: this.url.url })

    const notify = new cloudwatchActions.SnsAction(props.alertsTopic)

    const errors = new cloudwatch.Alarm(this, 'ErrorsAlarm', {
      alarmName: 'boom-busters-broker-errors',
      metric: this.handler.metricErrors({ period: Duration.minutes(5) }),
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    })
    errors.addAlarmAction(notify)

    // App-level 5xx responses (the handler logs every response as JSON).
    const fiveHundreds = new logs.MetricFilter(this, 'FiveHundredFilter', {
      logGroup,
      metricNamespace: 'boom-busters',
      metricName: 'Broker5xx',
      filterPattern: logs.FilterPattern.literal('{ $.event = "response" && $.status >= 500 }'),
      metricValue: '1',
    })
    const fiveHundredAlarm = new cloudwatch.Alarm(this, 'FiveHundredAlarm', {
      alarmName: 'boom-busters-broker-5xx',
      metric: fiveHundreds.metric({ period: Duration.minutes(5), statistic: 'Sum' }),
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    })
    fiveHundredAlarm.addAlarmAction(notify)

    // Webhook signature failures: a possible probe (section 12).
    const signatureRejections = new logs.MetricFilter(this, 'SignatureFilter', {
      logGroup,
      metricNamespace: 'boom-busters',
      metricName: 'SignatureRejections',
      filterPattern: logs.FilterPattern.literal('{ $.event = "signature-rejected" }'),
      metricValue: '1',
    })
    const signatureAlarm = new cloudwatch.Alarm(this, 'SignatureAlarm', {
      alarmName: 'boom-busters-broker-signature-failures',
      metric: signatureRejections.metric({ period: Duration.minutes(15), statistic: 'Sum' }),
      threshold: 3,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    })
    signatureAlarm.addAlarmAction(notify)

    // The render function running hotter than the broker's cap means the
    // cap has been bypassed somewhere — the runaway alarm (section 8.1).
    const concurrency = new cloudwatch.Alarm(this, 'RenderConcurrencyAlarm', {
      alarmName: 'boom-busters-render-concurrency',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/Lambda',
        metricName: 'ConcurrentExecutions',
        dimensionsMap: { FunctionName: config.remotion.functionName },
        statistic: 'Maximum',
        period: Duration.minutes(1),
      }),
      threshold: config.renderCap,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 3,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    })
    concurrency.addAlarmAction(notify)

    // Daily AWS spend guard (section 12). AWS Budgets notifies by email
    // directly; no billing-metrics region gymnastics required.
    if (config.alertEmail !== undefined) {
      new budgets.CfnBudget(this, 'DailySpend', {
        budget: {
          budgetName: 'boom-busters-daily-spend',
          budgetType: 'COST',
          timeUnit: 'DAILY',
          budgetLimit: { amount: config.dailyBudgetUsd, unit: 'USD' },
        },
        notificationsWithSubscribers: [
          {
            notification: {
              notificationType: 'ACTUAL',
              comparisonOperator: 'GREATER_THAN',
              threshold: 100,
              thresholdType: 'PERCENTAGE',
            },
            subscribers: [{ subscriptionType: 'EMAIL', address: config.alertEmail }],
          },
        ],
      })
    }
  }
}
