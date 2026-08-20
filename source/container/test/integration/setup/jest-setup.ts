// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Provide fake credentials so the SDK's default credential chain resolves
// immediately via fromEnv() instead of falling through to providers that
// use dynamic imports (which require --experimental-vm-modules in Jest).
process.env.AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID ?? 'fakeKey';
process.env.AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY ?? 'fakeSecret';

import { DynamoDBTestSetup } from './dynamodb-setup';

beforeAll(async () => {
  DynamoDBTestSetup.initialize();
});

afterAll(async () => {
  // Cleanup can be added here if needed
});