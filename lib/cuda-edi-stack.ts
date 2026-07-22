import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaEventSources from "aws-cdk-lib/aws-lambda-event-sources";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as path from "node:path";

export interface CudaEdiStackProps extends cdk.StackProps {
  environment: string;
}

/**
 * Infra stub for cuda-edi (ADR 0002 / 0003).
 * Declares queues, Lambdas, artifact bucket, and IAM sketches.
 * Deploy: npm run deploy:dev (after AWS creds + context).
 */
export class CudaEdiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: CudaEdiStackProps) {
    super(scope, id, props);

    const { environment } = props;
    const databaseUrl =
      this.node.tryGetContext("databaseUrl") || process.env.DATABASE_URL || "";
    const dbSecretArn =
      this.node.tryGetContext("ediDbSecretArn") ||
      process.env.EDI_DB_SECRET_ARN ||
      "";

    // Dedicated S3 for Payloads/Artifacts (queue messages carry refs only).
    // Not Supabase S3 — document switch later if we align with other CUDA services.
    const artifactsBucket = new s3.Bucket(this, "ArtifactsBucket", {
      bucketName: `cuda-edi-artifacts-${environment}-${cdk.Stack.of(this).account}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: true,
      enforceSSL: true,
      removalPolicy:
        environment === "prod"
          ? cdk.RemovalPolicy.RETAIN
          : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: environment !== "prod",
    });

    const outboundDlq = new sqs.Queue(this, "OutboundDlq", {
      queueName: `edi-outbound-dlq-${environment}.fifo`,
      fifo: true,
      retentionPeriod: cdk.Duration.days(14),
    });

    const outboundQueue = new sqs.Queue(this, "OutboundQueue", {
      queueName: `edi-outbound-${environment}.fifo`,
      fifo: true,
      contentBasedDeduplication: false,
      deduplicationScope: sqs.DeduplicationScope.MESSAGE_GROUP,
      fifoThroughputLimit: sqs.FifoThroughputLimit.PER_MESSAGE_GROUP_ID,
      visibilityTimeout: cdk.Duration.minutes(15),
      retentionPeriod: cdk.Duration.days(14),
      deadLetterQueue: { queue: outboundDlq, maxReceiveCount: 3 },
    });

    const inboundDlq = new sqs.Queue(this, "InboundDlq", {
      queueName: `edi-inbound-dlq-${environment}.fifo`,
      fifo: true,
      retentionPeriod: cdk.Duration.days(14),
    });

    const inboundQueue = new sqs.Queue(this, "InboundQueue", {
      queueName: `edi-inbound-${environment}.fifo`,
      fifo: true,
      contentBasedDeduplication: false,
      deduplicationScope: sqs.DeduplicationScope.MESSAGE_GROUP,
      fifoThroughputLimit: sqs.FifoThroughputLimit.PER_MESSAGE_GROUP_ID,
      visibilityTimeout: cdk.Duration.minutes(15),
      retentionPeriod: cdk.Duration.days(14),
      deadLetterQueue: { queue: inboundDlq, maxReceiveCount: 3 },
    });

    const sharedEnv: Record<string, string> = {
      ENVIRONMENT: environment,
      EDI_ARTIFACTS_BUCKET: artifactsBucket.bucketName,
      EDI_OUTBOUND_QUEUE_URL: outboundQueue.queueUrl,
      EDI_INBOUND_QUEUE_URL: inboundQueue.queueUrl,
      ...(databaseUrl ? { DATABASE_URL: databaseUrl } : {}),
      ...(dbSecretArn ? { EDI_DB_SECRET_ARN: dbSecretArn } : {}),
    };

    const enqueueFn = new lambda.Function(this, "EnqueueFunction", {
      functionName: `cuda-edi-enqueue-${environment}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      handler: "index.handler",
      code: lambda.Code.fromAsset(
        path.join(__dirname, "..", "lambda", "enqueue", "dist")
      ),
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: sharedEnv,
      logRetention: logs.RetentionDays.ONE_MONTH,
    });

    outboundQueue.grantSendMessages(enqueueFn);
    artifactsBucket.grantReadWrite(enqueueFn);

    // Thin SDK invokes this Lambda; no public Function URL (ADR 0003).
    enqueueFn.addPermission("AllowAccountInvoke", {
      principal: new iam.AccountPrincipal(cdk.Stack.of(this).account),
      action: "lambda:InvokeFunction",
    });

    if (dbSecretArn) {
      enqueueFn.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ["secretsmanager:GetSecretValue"],
          resources: [dbSecretArn],
        })
      );
    }

    const outboundWorker = new lambda.Function(this, "OutboundWorkerFunction", {
      functionName: `cuda-edi-outbound-worker-${environment}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      handler: "index.handler",
      code: lambda.Code.fromAsset(
        path.join(__dirname, "..", "lambda", "outbound-worker", "dist")
      ),
      timeout: cdk.Duration.minutes(15),
      memorySize: 512,
      environment: sharedEnv,
      logRetention: logs.RetentionDays.ONE_MONTH,
    });

    outboundQueue.grantConsumeMessages(outboundWorker);
    artifactsBucket.grantReadWrite(outboundWorker);
    outboundWorker.addEventSource(
      new lambdaEventSources.SqsEventSource(outboundQueue, {
        batchSize: 1,
        reportBatchItemFailures: true,
      })
    );

    if (dbSecretArn) {
      outboundWorker.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ["secretsmanager:GetSecretValue"],
          resources: [dbSecretArn],
        })
      );
    }

    // Inbound worker deferred — queue is a placeholder until Intake.

    new cdk.CfnOutput(this, "EnqueueFunctionName", {
      value: enqueueFn.functionName,
      description: "Pass to Enqueue SDK as functionName",
    });
    new cdk.CfnOutput(this, "OutboundQueueUrl", {
      value: outboundQueue.queueUrl,
    });
    new cdk.CfnOutput(this, "InboundQueueUrl", {
      value: inboundQueue.queueUrl,
    });
    new cdk.CfnOutput(this, "ArtifactsBucketName", {
      value: artifactsBucket.bucketName,
    });
  }
}
