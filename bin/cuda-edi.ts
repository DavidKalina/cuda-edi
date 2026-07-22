#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { CudaEdiStack } from "../lib/cuda-edi-stack";

const app = new cdk.App();

const environment = (app.node.tryGetContext("environment") as string) || "dev";
const validEnvironments = ["dev", "test", "prod"];
if (!validEnvironments.includes(environment)) {
  throw new Error(
    `Invalid environment: ${environment}. Must be one of: ${validEnvironments.join(", ")}`
  );
}

new CudaEdiStack(app, `CudaEdiStack-${environment}`, {
  environment,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || process.env.AWS_REGION || "us-west-2",
  },
  tags: {
    Environment: environment,
    Project: "cuda-edi",
  },
});
