// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { ECSClient, DescribeServicesCommand, waitUntilServicesStable } from '@aws-sdk/client-ecs';

export class EcsClient {
  private ecsClient: ECSClient;

  constructor(private region: string) {
    this.ecsClient = new ECSClient({ region });
  }

  async waitForDeployment(clusterName: string, serviceName: string, maxWaitSeconds = 600): Promise<void> {
    console.log('Waiting for ECS service to stabilize...');
    await waitUntilServicesStable(
      { client: this.ecsClient, maxWaitTime: maxWaitSeconds },
      { cluster: clusterName, services: [serviceName] }
    );
    
    console.log('Verifying deployment completed successfully...');
    await this.verifyDeploymentCompleted(clusterName, serviceName);
    
    console.log('ECS deployment completed and verified');
  }

  private async verifyDeploymentCompleted(cluster: string, service: string): Promise<void> {
    // rolloutState can lag behind service stability — poll until it transitions
    const maxRetries = 20;
    const retryIntervalMs = 15_000;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const response = await this.ecsClient.send(
        new DescribeServicesCommand({ cluster, services: [service] })
      );

      const svc = response.services?.[0];
      if (!svc) throw new Error(`Service ${service} not found`);

      const primaryDeployments = svc.deployments?.filter(d => d.status === 'PRIMARY') ?? [];
      if (primaryDeployments.length !== 1) {
        throw new Error(`Expected 1 PRIMARY deployment, found ${primaryDeployments.length}`);
      }

      const deployment = primaryDeployments[0];
      const activeDeployments = svc.deployments?.filter(d => d.status === 'ACTIVE') ?? [];

      if (deployment.rolloutState === 'COMPLETED' && activeDeployments.length === 0) {
        console.log(`Deployment ${deployment.id} verified: rolloutState=${deployment.rolloutState}`);
        return;
      }

      if (deployment.rolloutState === 'FAILED') {
        throw new Error(`Deployment rollout failed: ${deployment.rolloutStateReason}`);
      }

      console.log(`Attempt ${attempt}/${maxRetries}: rolloutState=${deployment.rolloutState}, activeDeployments=${activeDeployments.length}. Retrying in ${retryIntervalMs / 1000}s...`);
      await new Promise(resolve => setTimeout(resolve, retryIntervalMs));
    }

    throw new Error(`Deployment rollout did not complete after ${maxRetries} retries`);
  }
}
