// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { APIGatewayClient, GetRestApisCommand, UpdateStageCommand } from "@aws-sdk/client-api-gateway";

export class ApiGatewayClient {
  private readonly client: APIGatewayClient;

  constructor(private region: string) {
    this.client = new APIGatewayClient({ region });
  }

  async getRestApiIdFromUrl(apiUrl: string): Promise<string> {
    // Extract API ID from URL like https://{api-id}.execute-api.{region}.amazonaws.com/prod
    const match = apiUrl.match(/https:\/\/([^.]+)\.execute-api/);
    if (match) {
      return match[1];
    }

    // Fallback: list APIs and find by endpoint
    const response = await this.client.send(new GetRestApisCommand({}));
    const api = response.items?.find((item) => apiUrl.includes(item.id!));
    if (!api?.id) {
      throw new Error(`Could not find REST API for URL: ${apiUrl}`);
    }
    return api.id;
  }

  async removeThrottling(apiId: string, stageName: string = "prod"): Promise<void> {
    await this.client.send(
      new UpdateStageCommand({
        restApiId: apiId,
        stageName,
        patchOperations: [
          { op: "replace", path: "/*/*/throttling/rateLimit", value: "-1" },
          { op: "replace", path: "/*/*/throttling/burstLimit", value: "-1" },
        ],
      })
    );
  }

  async restoreThrottling(
    apiId: string,
    stageName: string = "prod", // solution configured values, throttling limits
    rateLimit: number = 100,
    burstLimit: number = 200
  ): Promise<void> {
    await this.client.send(
      new UpdateStageCommand({
        restApiId: apiId,
        stageName,
        patchOperations: [
          { op: "replace", path: "/*/*/throttling/rateLimit", value: String(rateLimit) },
          { op: "replace", path: "/*/*/throttling/burstLimit", value: String(burstLimit) },
        ],
      })
    );
  }
}
