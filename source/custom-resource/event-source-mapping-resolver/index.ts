// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import {
  LambdaClient,
  ListEventSourceMappingsCommand,
  DeleteEventSourceMappingCommand,
} from "@aws-sdk/client-lambda";
import { CloudFormationClient, ListStackResourcesCommand } from "@aws-sdk/client-cloudformation";
import { getOptions } from "../../solution-utils/get-options";

const lambdaClient = new LambdaClient(getOptions());
const cfnClient = new CloudFormationClient(getOptions());

interface CustomResourceEvent {
  RequestType: "Create" | "Update" | "Delete";
  ResponseURL: string;
  StackId: string;
  RequestId: string;
  LogicalResourceId: string;
  PhysicalResourceId?: string;
  ResourceProperties: {
    FunctionName: string;
    EventSourceArn: string;
  };
}

interface LambdaContext {
  logStreamName: string;
  getRemainingTimeInMillis(): number;
}

export async function handler(event: CustomResourceEvent, context: LambdaContext) {
  console.info(`Received event: ${event.RequestType}`);

  const response = { Status: "SUCCESS", Data: {} as Record<string, unknown> };

  try {
    if (event.RequestType === "Create") {
      await resolveConflict(event.ResourceProperties, event.StackId, context);
    }
    // Update and Delete are no-ops
  } catch (error) {
    console.error("Error resolving EventSourceMapping conflict:", error);
    response.Status = "FAILED";
    response.Data = { Error: { Code: "ResolveConflictError", Message: (error as Error).message } };
  } finally {
    try {
      await sendResponse(event, context.logStreamName, response);
    } catch (sendErr) {
      console.error("Failed to send CloudFormation response:", sendErr);
    }
  }

  return response;
}

async function resolveConflict(
  props: { FunctionName: string; EventSourceArn: string },
  stackId: string,
  context: LambdaContext
) {
  if (!(await hasLegacyEventSourceMapping(stackId))) {
    console.info("No legacy EventSourceMapping logical ID found. Skipping — not a v7→v8 upgrade.");
    return;
  }

  const { FunctionName, EventSourceArn } = props;

  const { EventSourceMappings = [] } = await lambdaClient.send(
    new ListEventSourceMappingsCommand({ FunctionName, EventSourceArn })
  );

  if (EventSourceMappings.length === 0) {
    console.info("No existing EventSourceMapping found. No conflict to resolve.");
    return;
  }

  // Delete all existing mappings for this pair — there should be at most one,
  // but we handle multiples defensively.
  for (const mapping of EventSourceMappings) {
    console.info(`Deleting conflicting EventSourceMapping: ${mapping.UUID}`);
    try {
      await lambdaClient.send(new DeleteEventSourceMappingCommand({ UUID: mapping.UUID }));
      console.info(`Deleted EventSourceMapping: ${mapping.UUID}`);
    } catch (err: any) {
      if (err.name !== "ResourceNotFoundException") throw err;
      console.info(`EventSourceMapping ${mapping.UUID} already deleted.`);
    }
  }

  // Wait for deletion to fully propagate. Lambda's DeleteEventSourceMapping is
  // eventually consistent — the mapping transitions through a "Deleting" state.
  // CloudFormation will fail to create the new mapping if the old one is still
  // in this transitional state.
  const safetyMarginMs = 5_000;
  const pollIntervalMs = 2_000;

  while (context.getRemainingTimeInMillis() > safetyMarginMs) {
    const { EventSourceMappings: remaining = [] } = await lambdaClient.send(
      new ListEventSourceMappingsCommand({ FunctionName, EventSourceArn })
    );
    if (remaining.length === 0) {
      console.info("EventSourceMapping fully deleted.");
      return;
    }
    console.info(`Waiting for deletion to propagate... (${remaining.length} mapping(s) still present)`);
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error("Timed out waiting for EventSourceMapping deletion to propagate.");
}

async function hasLegacyEventSourceMapping(stackId: string): Promise<boolean> {
  let nextToken: string | undefined;
  do {
    const { StackResourceSummaries = [], NextToken } = await cfnClient.send(
      new ListStackResourcesCommand({ StackName: stackId, NextToken: nextToken })
    );
    const found = StackResourceSummaries.some(
      (r) =>
        r.ResourceType === "AWS::Lambda::EventSourceMapping" &&
        r.LogicalResourceId?.includes("ServerlessImageHandlerStack")
    );
    if (found) return true;
    nextToken = NextToken;
  } while (nextToken);
  return false;
}

async function sendResponse(
  event: CustomResourceEvent,
  logStreamName: string,
  response: { Status: string; Data: Record<string, unknown> }
) {
  const body = JSON.stringify({
    Status: response.Status,
    Reason: `See CloudWatch Log Stream: ${logStreamName}`,
    PhysicalResourceId: event.LogicalResourceId,
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
    Data: response.Data,
  });

  await fetch(event.ResponseURL, {
    method: "PUT",
    headers: { "Content-Type": "", "Content-Length": String(body.length) },
    body,
  });
}
