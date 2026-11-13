/**
 * M1.2 review fix: cancelling a job on a live Kubernetes cluster while `kubectl apply` is
 * still running must not leave the job running. kubectl is simulated: the cluster reports as
 * available and `apply` stays pending until the test releases it.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, vi, afterEach } from 'vitest';

const commands: string[] = [];
let releaseApply: (() => void) | null = null;

vi.mock('child_process', () => ({
  // kubectl is called through execFile with an argument array (P0/F10); the test records
  // each call as one command line for readability.
  execFile: (file: string, args: string[], _opts: unknown, cb: (err: Error | null, out?: { stdout: string; stderr: string }) => void) => {
    const cmd = [file, ...args].join(' ');
    commands.push(cmd);
    if (cmd.startsWith('kubectl cluster-info')) return cb(null, { stdout: 'Kubernetes control plane is running', stderr: '' });
    if (cmd.startsWith('kubectl apply')) {
      releaseApply = () => cb(null, { stdout: 'job.batch/created', stderr: '' });
      return;
    }
    if (cmd.startsWith('kubectl delete job')) return cb(null, { stdout: 'deleted', stderr: '' });
    return cb(new Error(`unexpected command in test: ${cmd}`));
  },
}));

import { K8sConnector } from '../../src/services/k8sConnector';

const flush = () => new Promise((r) => setTimeout(r, 0));
const manifestPath = (jobId: string) => path.join(os.tmpdir(), `carbonroute-carbonroute-${jobId}-${process.pid}.json`);

afterEach(() => {
  for (const id of ['job-race1', 'job-race2']) if (fs.existsSync(manifestPath(id))) fs.unlinkSync(manifestPath(id));
  commands.length = 0;
  releaseApply = null;
});

describe('cancelling on a live cluster', () => {
  it('a job cancelled while kubectl apply is running is deleted afterwards and never marked running', async () => {
    const job = { id: 'job-race1', commandOrImage: 'busybox', isContainerImage: true, cpu: 1, memoryMb: 128 };
    const record = await K8sConnector.dispatchJob(job, { predictedCarbon: 100 });
    expect(record.clusterMode).toBe('minikube');
    expect(record.status).toBe('scheduled');
    expect(releaseApply).not.toBeNull(); // apply is in flight

    await K8sConnector.cancelExecution('job-race1', 'owner');
    expect(record.status).toBe('cancelled');
    const deletesBeforeApply = commands.filter((c) => c.startsWith('kubectl delete job')).length;
    expect(deletesBeforeApply).toBe(1); // this delete ran before the Job existed

    releaseApply!();
    await flush();
    await flush();

    expect(record.status).toBe('cancelled');
    expect(commands.filter((c) => c.startsWith('kubectl delete job carbonroute-job-race1'))).toHaveLength(2);
    expect(commands.some((c) => c.startsWith('kubectl get job'))).toBe(false); // no completion polling
    expect(record.logs.join('\n')).toMatch(/Cancelled while the manifest was being applied/);
    expect(fs.existsSync(manifestPath('job-race1'))).toBe(false);
  });

  it('a job that was not cancelled is marked running after apply', async () => {
    const job = { id: 'job-race2', commandOrImage: 'busybox', isContainerImage: true, cpu: 1, memoryMb: 128 };
    const record = await K8sConnector.dispatchJob(job, { predictedCarbon: 100 });
    releaseApply!();
    await flush();
    expect(record.status).toBe('running');
    expect(commands.some((c) => c.startsWith('kubectl delete job'))).toBe(false);
    // Stop the completion poller started for this record.
    await K8sConnector.cancelExecution('job-race2', 'test-cleanup');
  });
});
