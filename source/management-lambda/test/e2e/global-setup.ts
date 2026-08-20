// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { ApiGatewayClient } from "./apigw-client";
import { CfnClient } from "./cfn-client";
import { CognitoClient } from "./cognito-client";
import { DynamoDBClient } from "./dynamodb-client";
import { loadEnvironment } from "./utils";

const globalSetup = async (): Promise<void> => {
  console.log(" 🌍 Running global setup...");

  const { region, stackName } = loadEnvironment();

  const solution = await new CfnClient(region).readCfnStackDetails(stackName);
  const cognitoClient = new CognitoClient(region);

  await new DynamoDBClient(region, solution.configTable).clearTable();

  const { base64Credentials, clientId } = await cognitoClient.createCognitoAppClient({
    userPoolId: solution.userPoolId,
  });

  const apiAccessToken = await cognitoClient.fetchAccessToken({
    base64Credentials,
    cognitoDomainPrefix: solution.cognitoDomainPrefix,
  });

  // Remove API throttling so non-throttling e2e tests don't get rate-limited
  // Skip when running throttling tests only (SKIP_THROTTLING_REMOVAL=true)
  const apigwClient = new ApiGatewayClient(region);
  const apiId = await apigwClient.getRestApiIdFromUrl(solution.apiUrl);

  if (process.env.SKIP_THROTTLING_REMOVAL !== "true") {
    await apigwClient.removeThrottling(apiId);

    // API Gateway edge enforcement is eventually consistent — buffer wait to let it fully propagate.
    console.log(" ⏳ Waiting 120s for API throttling removal to fully propagate at the edge...");
    await new Promise((resolve) => setTimeout(resolve, 120000));
  } else {
    console.log(" ⏭️ Skipping API throttling removal (SKIP_THROTTLING_REMOVAL=true)");
  }

  // token and api url needed for test execution
  // user pool and client id needed for cleaning app client created for test
  Object.assign(process.env, {
    TEST_ACCESS_TOKEN: apiAccessToken,
    TEST_CLIENT_ID: clientId,
    API_URL: solution.apiUrl,
    USER_POOL_ID: solution.userPoolId,
    TABLE_NAME: solution.configTable,
    CONSOLE_URL: solution.consoleUrl,
    API_ID: apiId,
  });

  console.log(" 🔧 Global setup complete, dynamodb cleared and test cognito app client configured");
  console.log(" 🚀 Starting test execution...");
};

export default globalSetup;
