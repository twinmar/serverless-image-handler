// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const mockLambdaCommands = {
  listEventSourceMappings: jest.fn(),
  deleteEventSourceMapping: jest.fn(),
};

const mockCfnCommands = {
  listStackResources: jest.fn(),
};

jest.mock("@aws-sdk/client-lambda", () => {
  const actual = jest.requireActual("@aws-sdk/client-lambda");
  return {
    LambdaClient: jest.fn(() => ({
      send: jest.fn((command) => {
        if (command instanceof actual.ListEventSourceMappingsCommand) {
          return mockLambdaCommands.listEventSourceMappings(command.input);
        }
        if (command instanceof actual.DeleteEventSourceMappingCommand) {
          return mockLambdaCommands.deleteEventSourceMapping(command.input);
        }
        throw new Error(`Unimplemented command: ${command.constructor.name}`);
      }),
    })),
    ListEventSourceMappingsCommand: actual.ListEventSourceMappingsCommand,
    DeleteEventSourceMappingCommand: actual.DeleteEventSourceMappingCommand,
  };
});

jest.mock("@aws-sdk/client-cloudformation", () => {
  const actual = jest.requireActual("@aws-sdk/client-cloudformation");
  return {
    CloudFormationClient: jest.fn(() => ({
      send: jest.fn((command) => {
        if (command instanceof actual.ListStackResourcesCommand) {
          return mockCfnCommands.listStackResources(command.input);
        }
        throw new Error(`Unimplemented command: ${command.constructor.name}`);
      }),
    })),
    ListStackResourcesCommand: actual.ListStackResourcesCommand,
  };
});

const mockFetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });
global.fetch = mockFetch;

jest.mock("../../solution-utils/get-options", () => ({
  getOptions: jest.fn(() => ({})),
}));

import { handler } from "../event-source-mapping-resolver/index";

const mockContext = { logStreamName: "mock-stream", getRemainingTimeInMillis: jest.fn(() => 30_000) };

const baseEvent = {
  ResponseURL: "/cfn-response",
  StackId: "arn:aws:cloudformation:us-east-1:123456789012:stack/test/guid",
  RequestId: "mock-request-id",
  LogicalResourceId: "mock-logical-id",
  ResourceProperties: {
    FunctionName: "MetricsLambda",
    EventSourceArn: "arn:aws:sqs:us-east-1:123456789012:metrics-queue",
  },
};

/** Helper: mock CFN to return the legacy v7 logical ID */
function mockLegacyStack() {
  mockCfnCommands.listStackResources.mockResolvedValue({
    StackResourceSummaries: [
      {
        ResourceType: "AWS::Lambda::EventSourceMapping",
        LogicalResourceId: "MetricsSqsEventSourceServerlessImageHandlerStackQueue123",
      },
    ],
  });
}

/** Helper: mock CFN to return only v8-style logical IDs (no legacy) */
function mockV8Stack() {
  mockCfnCommands.listStackResources.mockResolvedValue({
    StackResourceSummaries: [
      {
        ResourceType: "AWS::Lambda::EventSourceMapping",
        LogicalResourceId: "MetricsSqsEventsourcev7StackQueue456",
      },
    ],
  });
}

describe("EventSourceMappingResolver", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockContext.getRemainingTimeInMillis.mockReturnValue(30_000);
  });

  it("should delete conflicting mapping on Create when legacy logical ID exists", async () => {
    mockLegacyStack();
    mockLambdaCommands.listEventSourceMappings
      .mockResolvedValueOnce({ EventSourceMappings: [{ UUID: "existing-uuid-123" }] })
      .mockResolvedValue({ EventSourceMappings: [] });
    mockLambdaCommands.deleteEventSourceMapping.mockResolvedValue({});

    const response = await handler({ ...baseEvent, RequestType: "Create" } as any, mockContext);

    expect(response.Status).toBe("SUCCESS");
    expect(mockLambdaCommands.deleteEventSourceMapping).toHaveBeenCalledWith({
      UUID: "existing-uuid-123",
    });
  });

  it("should skip deletion on Create when no legacy logical ID exists (v8→v8 upgrade)", async () => {
    mockV8Stack();

    const response = await handler({ ...baseEvent, RequestType: "Create" } as any, mockContext);

    expect(response.Status).toBe("SUCCESS");
    expect(mockLambdaCommands.listEventSourceMappings).not.toHaveBeenCalled();
    expect(mockLambdaCommands.deleteEventSourceMapping).not.toHaveBeenCalled();
  });

  it("should do nothing on Create when legacy exists but no mapping found", async () => {
    mockLegacyStack();
    mockLambdaCommands.listEventSourceMappings.mockResolvedValue({
      EventSourceMappings: [],
    });

    const response = await handler({ ...baseEvent, RequestType: "Create" } as any, mockContext);

    expect(response.Status).toBe("SUCCESS");
    expect(mockLambdaCommands.deleteEventSourceMapping).not.toHaveBeenCalled();
  });

  it("should skip deletion on Update", async () => {
    const response = await handler({ ...baseEvent, RequestType: "Update" } as any, mockContext);

    expect(response.Status).toBe("SUCCESS");
    expect(mockCfnCommands.listStackResources).not.toHaveBeenCalled();
    expect(mockLambdaCommands.listEventSourceMappings).not.toHaveBeenCalled();
    expect(mockLambdaCommands.deleteEventSourceMapping).not.toHaveBeenCalled();
  });

  it("should skip deletion on Delete", async () => {
    const response = await handler({ ...baseEvent, RequestType: "Delete" } as any, mockContext);

    expect(response.Status).toBe("SUCCESS");
    expect(mockCfnCommands.listStackResources).not.toHaveBeenCalled();
    expect(mockLambdaCommands.listEventSourceMappings).not.toHaveBeenCalled();
    expect(mockLambdaCommands.deleteEventSourceMapping).not.toHaveBeenCalled();
  });

  it("should return FAILED and send response when deletion errors", async () => {
    mockLegacyStack();
    mockLambdaCommands.listEventSourceMappings.mockResolvedValue({
      EventSourceMappings: [{ UUID: "existing-uuid-123" }],
    });
    mockLambdaCommands.deleteEventSourceMapping.mockRejectedValue(new Error("Access denied"));

    const response = await handler({ ...baseEvent, RequestType: "Create" } as any, mockContext);

    expect(response.Status).toBe("FAILED");
    expect(response.Data).toEqual({
      Error: { Code: "ResolveConflictError", Message: "Access denied" },
    });
    expect(mockFetch).toHaveBeenCalledWith(
      "/cfn-response",
      expect.objectContaining({
        method: "PUT",
        body: expect.stringContaining('"Status":"FAILED"'),
      })
    );
  });

  it("should always send CloudFormation response", async () => {
    mockLegacyStack();
    mockLambdaCommands.listEventSourceMappings.mockResolvedValue({
      EventSourceMappings: [],
    });

    await handler({ ...baseEvent, RequestType: "Create" } as any, mockContext);

    expect(mockFetch).toHaveBeenCalledWith(
      "/cfn-response",
      expect.objectContaining({
        method: "PUT",
        body: expect.stringContaining('"Status":"SUCCESS"'),
      })
    );
  });

  it("should delete multiple mappings if they exist", async () => {
    mockLegacyStack();
    mockLambdaCommands.listEventSourceMappings
      .mockResolvedValueOnce({ EventSourceMappings: [{ UUID: "uuid-1" }, { UUID: "uuid-2" }] })
      .mockResolvedValue({ EventSourceMappings: [] });
    mockLambdaCommands.deleteEventSourceMapping.mockResolvedValue({});

    const response = await handler({ ...baseEvent, RequestType: "Create" } as any, mockContext);

    expect(response.Status).toBe("SUCCESS");
    expect(mockLambdaCommands.deleteEventSourceMapping).toHaveBeenCalledTimes(2);
    expect(mockLambdaCommands.deleteEventSourceMapping).toHaveBeenCalledWith({ UUID: "uuid-1" });
    expect(mockLambdaCommands.deleteEventSourceMapping).toHaveBeenCalledWith({ UUID: "uuid-2" });
  });

  it("should succeed when delete throws ResourceNotFoundException", async () => {
    mockLegacyStack();
    const notFoundError = new Error("Mapping not found");
    notFoundError.name = "ResourceNotFoundException";
    mockLambdaCommands.listEventSourceMappings
      .mockResolvedValueOnce({ EventSourceMappings: [{ UUID: "already-gone" }] })
      .mockResolvedValue({ EventSourceMappings: [] });
    mockLambdaCommands.deleteEventSourceMapping.mockRejectedValue(notFoundError);

    const response = await handler({ ...baseEvent, RequestType: "Create" } as any, mockContext);

    expect(response.Status).toBe("SUCCESS");
    expect(mockLambdaCommands.deleteEventSourceMapping).toHaveBeenCalledWith({ UUID: "already-gone" });
  });

  it("should return FAILED when polling times out", async () => {
    mockLegacyStack();
    mockLambdaCommands.listEventSourceMappings
      .mockResolvedValueOnce({ EventSourceMappings: [{ UUID: "stuck-uuid" }] })
      .mockResolvedValue({ EventSourceMappings: [{ UUID: "stuck-uuid" }] });
    mockLambdaCommands.deleteEventSourceMapping.mockResolvedValue({});
    mockContext.getRemainingTimeInMillis.mockReturnValue(3_000);

    const response = await handler({ ...baseEvent, RequestType: "Create" } as any, mockContext);

    expect(response.Status).toBe("FAILED");
    expect(response.Data).toEqual({
      Error: {
        Code: "ResolveConflictError",
        Message: "Timed out waiting for EventSourceMapping deletion to propagate.",
      },
    });
  });
});
