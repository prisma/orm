import { fileURLToPath } from 'node:url';

import { BuildError, BunBuild, ComputeClient } from '@prisma/compute-sdk';
import { createManagementApiClient } from '@prisma/management-api-sdk';

const token = process.env['TELEMETRY_DEPLOY_SERVICE_TOKEN'];
if (!token) {
  throw new Error('TELEMETRY_DEPLOY_SERVICE_TOKEN not set');
}

const projectId = process.env['TELEMETRY_DEPLOY_PROJECT_ID'];
if (!projectId) {
  throw new Error('TELEMETRY_DEPLOY_PROJECT_ID not set');
}

const appId = process.env['TELEMETRY_DEPLOY_SERVICE_ID'];
if (!appId) {
  throw new Error('TELEMETRY_DEPLOY_SERVICE_ID not set');
}

const api = createManagementApiClient({ token });
const compute = new ComputeClient(api);

const result = await compute.deploy({
  strategy: new BunBuild({
    appPath: fileURLToPath(new URL('..', import.meta.url)),
    entrypoint: 'src/server.ts',
  }),
  projectId,
  appId,
  progress: {
    onBuildStart() {
      console.log('Building application...');
    },
    onBuildComplete(artifact) {
      console.log(`Build complete: ${artifact.directory}/${artifact.entrypoint}`);
    },
    onArchiveCreating() {
      console.log('Creating archive...');
    },
    onArchiveReady(sizeBytes) {
      console.log(`Archive ready (${sizeBytes} bytes)`);
    },
    onDeploymentCreated(deploymentId) {
      console.log(`Deployment created: ${deploymentId}`);
    },
    onUploadStart() {
      console.log('Uploading archive...');
    },
    onUploadComplete() {
      console.log('Upload complete');
    },
    onStartRequested() {
      console.log('Start requested');
    },
    onStatusChange(status) {
      console.log(`Status: ${status}`);
    },
    onRunning(deploymentUrl) {
      console.log(`Deployment running at ${deploymentUrl}`);
    },
    onPromoteStart() {
      console.log('Promoting new deployment...');
    },
    onPromoted(appEndpointDomain) {
      console.log(`Promoted: ${appEndpointDomain}`);
    },
    onPromoteFailed(error) {
      console.error(`Promote failed: ${error}`);
    },
    onOldDeploymentStopping(deploymentId) {
      console.log(`Stopping old deployment ${deploymentId}...`);
    },
    onOldDeploymentStopped(deploymentId) {
      console.log(`Stopped old deployment ${deploymentId}`);
    },
    onOldDeploymentStopFailed(deploymentId) {
      console.error(`Failed to stop old deployment ${deploymentId}`);
    },
    onOldDeploymentDeleting(deploymentId) {
      console.log(`Deleting old deployment ${deploymentId}...`);
    },
    onOldDeploymentDeleted(deploymentId) {
      console.log(`Deleted old deployment ${deploymentId}`);
    },
    onOldDeploymentDeleteFailed(deploymentId) {
      console.error(`Failed to delete old deployment ${deploymentId}`);
    },
    onCleanupDanglingDeployment(deploymentId) {
      console.log(`Cleaning up dangling deployment ${deploymentId}...`);
    },
    onCleanupDanglingDeploymentComplete(deploymentId) {
      console.log(`Cleaned up dangling deployment ${deploymentId}`);
    },
    onCleanupDanglingDeploymentFailed(deploymentId) {
      console.error(`Failed to clean up dangling deployment ${deploymentId}`);
    },
  },
});

result.match({
  ok: (deployment) => {
    console.log('Deploy succeeded:');
    console.log(`  deployment:     ${deployment.deploymentId}`);
    console.log(`  deployment URL: ${deployment.deploymentEndpointDomain}`);
    if (deployment.promoted && deployment.appEndpointDomain) {
      console.log(`  app URL:        ${deployment.appEndpointDomain}`);
    }
    if (deployment.previousDeploymentId) {
      console.log(
        `  previous deployment ${deployment.previousDeploymentId}: ${deployment.previousDeploymentAction ?? 'unchanged'}`,
      );
    }
  },
  err: (error) => {
    console.error(`Deploy failed [${error._tag}]: ${error.message}`);
    if (BuildError.is(error) && error.logs?.length) {
      console.error(error.logs.join('\n'));
    }
    process.exit(1);
  },
});
