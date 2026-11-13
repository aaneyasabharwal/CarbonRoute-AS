import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

const execAsync = promisify(exec);

export interface K8sJobExecutionRecord {
  success: boolean;
  jobId: string;
  k8sJobName: string;
  podId: string;
  podName: string;
  namespace: string;
  status: 'pending' | 'scheduled' | 'running' | 'completed' | 'failed' | 'cancelled';
  containerImage: string;
  command: string;
  scheduledStartTime: string;
  startedAt?: string;
  actualStartTime?: string;
  completedAt?: string;
  completionTime?: string;
  exitCode?: number;
  logs: string[];
  clusterMode: 'minikube' | 'offline_fallback';
  clusterNotice: string;
  predictedCarbon: number;
  /**
   * Never set by the connector. Realized carbon comes only from provider observations
   * collected after the scheduled window (POST /api/jobs/:id/observations). The earlier
   * random "realized" values were removed (audit C2).
   */
  realizedCarbon?: number;
  carbonError?: number;
  carbonObservation: 'collect-from-provider-after-window';
  durationSeconds: number;
}

// In-memory active execution store
const activeExecutions = new Map<string, K8sJobExecutionRecord>();

export class K8sConnector {
  /**
   * Checks if local Minikube / Kubectl cluster is accessible
   */
  public static async checkClusterHealth(): Promise<{ isAvailable: boolean; message: string }> {
    try {
      const { stdout } = await execAsync('kubectl cluster-info --request-timeout=2s');
      return {
        isAvailable: true,
        message: stdout.split('\n')[0] || 'Live Kubernetes / Minikube cluster accessible.',
      };
    } catch {
      return {
        isAvailable: false,
        message:
          'Local Minikube/Kubernetes cluster not detected or offline. Jobs will be simulated (no workload process is run). Run "minikube start" to use a real cluster.',
      };
    }
  }

  /**
   * Generates a valid Kubernetes batch/v1 declarative Job manifest from workload config
   */
  public static generateJobManifest(
    job: any,
    scheduledHour: number = 0,
    k8sJobName?: string
  ): any {
    const rawId = typeof job === 'object' && job !== null ? (job.id || 'job') : String(job || 'job');
    const cleanId = String(rawId).toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 16);
    const name = k8sJobName || `carbonroute-${cleanId}`;
    const cpu = typeof job === 'object' && job !== null ? (job.cpu || 1) : 1;
    const memoryMb = typeof job === 'object' && job !== null ? (job.memoryMb || 512) : 512;

    // Use user-supplied command or container image
    let containerImage = 'ghcr.io/carbonroute/workload-synthetic:latest';
    let containerCommand: string[] = ['python', '/app/workload.py', '--epochs', '5'];

    if (typeof job === 'object' && job !== null) {
      if (job.isContainerImage && job.commandOrImage && !job.commandOrImage.startsWith('python')) {
        containerImage = job.commandOrImage;
        containerCommand = ['sh', '-c', 'echo "Starting container workload..." && sleep 2'];
      } else if (job.commandOrImage) {
        containerCommand = ['sh', '-c', job.commandOrImage];
      }
    }

    const manifest = {
      apiVersion: 'batch/v1',
      kind: 'Job',
      metadata: {
        name,
        namespace: 'carbonroute-jobs',
        labels: {
          app: 'carbonroute-workload',
          'carbonroute.io/job-id': String(rawId),
          'carbonroute.io/scheduled-hour': `T+${scheduledHour}`,
          'carbonroute.io/managed-by': 'carbonroute-scheduler',
        },
      },
      spec: {
        backoffLimit: 2,
        ttlSecondsAfterFinished: 3600,
        template: {
          metadata: {
            labels: {
              app: 'carbonroute-workload',
              'carbonroute.io/job-id': String(rawId),
            },
          },
          spec: {
            restartPolicy: 'Never',
            containers: [
              {
                name: 'workload-runner',
                image: containerImage,
                command: containerCommand,
                resources: {
                  requests: {
                    cpu: `${cpu}`,
                    memory: `${memoryMb}Mi`,
                  },
                  limits: {
                    cpu: `${cpu}`,
                    memory: `${memoryMb}Mi`,
                  },
                },
                env: [
                  { name: 'CARBONROUTE_JOB_ID', value: String(rawId) },
                  { name: 'CARBONROUTE_SCHEDULED_HOUR', value: String(scheduledHour) },
                  { name: 'CARBONROUTE_REGION', value: String(job?.region || 'US-CAL-CISO') },
                ],
              },
            ],
          },
        },
      },
    };

    // Self-validate before returning
    if (!manifest.apiVersion || manifest.kind !== 'Job' || !manifest.spec?.template?.spec?.containers) {
      throw new Error('Generated Kubernetes manifest failed schema validation.');
    }

    return manifest;
  }

  /**
   * Dispatches a batch workload either to a live Kubernetes cluster or the verified local sandbox runner
   */
  public static async dispatchJob(
    jobOrId: any,
    containerImageOrDecision?: any,
    command?: string,
    cpu?: number,
    memoryMb?: number,
    predictedCarbon?: number,
    simulatedDurationSec: number = 5
  ): Promise<K8sJobExecutionRecord> {
    let jobId: string;
    let containerImage: string;
    let cmd: string;
    let cores: number;
    let ram: number;
    let carbon: number;
    let durationSec = Math.max(1, Number(simulatedDurationSec) || 5);

    if (typeof jobOrId === 'object' && jobOrId !== null) {
      jobId = String(jobOrId.id || 'job-unknown');
      containerImage = jobOrId.isContainerImage
        ? jobOrId.commandOrImage
        : 'ghcr.io/carbonroute/workload-synthetic:latest';
      cmd = jobOrId.commandOrImage || 'python workload.py';
      cores = Number(jobOrId.cpu) || 1;
      ram = Number(jobOrId.memoryMb) || 512;
      carbon =
        typeof containerImageOrDecision === 'object' && containerImageOrDecision !== null
          ? Number(containerImageOrDecision.predictedCarbon) || 200
          : Number(predictedCarbon) || 200;
    } else {
      jobId = String(jobOrId || 'job-unknown');
      containerImage =
        typeof containerImageOrDecision === 'string'
          ? containerImageOrDecision
          : 'ghcr.io/carbonroute/workload-synthetic:latest';
      cmd = command || 'python workload.py';
      cores = Number(cpu) || 1;
      ram = Number(memoryMb) || 512;
      carbon = Number(predictedCarbon) || 200;
    }

    const clusterHealth = await this.checkClusterHealth();
    const cleanId = jobId.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 16);
    const k8sJobName = `carbonroute-${cleanId}`;
    const podId = `${k8sJobName}-pod-${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date();

    const record: K8sJobExecutionRecord = {
      success: true,
      jobId,
      k8sJobName,
      podId,
      podName: podId,
      namespace: 'carbonroute-jobs',
      status: 'pending',
      containerImage: containerImage || 'ghcr.io/carbonroute/workload-synthetic:latest',
      command: cmd,
      scheduledStartTime: now.toISOString(),
      logs: [
        `[${now.toISOString()}] [CarbonRoute Dispatcher] Initiating workload dispatch for ${jobId}`,
        `[${now.toISOString()}] [CarbonRoute Dispatcher] Target Resources: ${cores} CPU Core(s), ${ram} MiB RAM`,
      ],
      clusterMode: clusterHealth.isAvailable ? 'minikube' : 'offline_fallback',
      clusterNotice: clusterHealth.isAvailable
        ? 'Live Kubernetes Cluster (Connected to Minikube/Local Cluster).'
        : 'Simulated execution (no Kubernetes cluster available): no workload process is run.',
      predictedCarbon: carbon,
      carbonObservation: 'collect-from-provider-after-window',
      durationSeconds: durationSec,
    };

    activeExecutions.set(jobId, record);

    if (clusterHealth.isAvailable) {
      this.executeOnK8s(record, cores, ram);
    } else {
      this.executeInSandbox(record, durationSec);
    }

    return record;
  }

  public static getJobExecution(jobId: string): K8sJobExecutionRecord | undefined {
    return activeExecutions.get(jobId);
  }

  public static getExecutionStatus(jobId: string): K8sJobExecutionRecord | undefined {
    return activeExecutions.get(jobId);
  }

  public static getAllExecutions(): K8sJobExecutionRecord[] {
    return Array.from(activeExecutions.values());
  }

  /**
   * Cancels a job's execution (M1.2). Returns the record, or null if the job has no
   * execution. Finished executions cannot be cancelled. On a live cluster the Kubernetes Job
   * is deleted; the simulated runner stops at its next step.
   */
  public static async cancelExecution(jobId: string, by: string): Promise<K8sJobExecutionRecord | null> {
    const record = activeExecutions.get(jobId);
    if (!record) return null;
    if (record.status === 'completed' || record.status === 'failed' || record.status === 'cancelled') return record;
    const wasLive = record.clusterMode === 'minikube';
    record.status = 'cancelled';
    record.completionTime = new Date().toISOString();
    record.completedAt = record.completionTime;
    record.logs.push(`[${record.completionTime}] [CarbonRoute Dispatcher] Execution cancelled by ${by}.`);
    if (wasLive) {
      await execAsync(`kubectl delete job ${record.k8sJobName} -n carbonroute-jobs --ignore-not-found`).catch((err: any) => {
        record.logs.push(`[${new Date().toISOString()}] Could not delete the Kubernetes Job: ${err.message}`);
      });
    }
    return record;
  }

  private static async executeOnK8s(record: K8sJobExecutionRecord, cpu: number, memoryMb: number) {
    try {
      const manifest = `
apiVersion: batch/v1
kind: Job
metadata:
  name: ${record.k8sJobName}
  namespace: carbonroute-jobs
  labels:
    app: carbonroute-workload
    job-id: "${record.jobId}"
spec:
  backoffLimit: 1
  template:
    metadata:
      name: ${record.podName}
    spec:
      restartPolicy: Never
      containers:
      - name: batch-worker
        image: ${record.containerImage}
        command: ["sh", "-c", "${record.command}"]
        resources:
          limits:
            cpu: "${cpu}"
            memory: "${memoryMb}Mi"
`;
      const tempPath = path.join(process.cwd(), `k8s-${record.k8sJobName}.yaml`);
      fs.writeFileSync(tempPath, manifest);

      record.status = 'scheduled';
      record.logs.push(`[${new Date().toISOString()}] Applied Kubernetes Job manifest to cluster.`);

      await execAsync(`kubectl apply -f "${tempPath}"`);
      // The job may have been cancelled while the manifest was being applied. Its delete
      // then ran before the Job existed, so delete it now and do not mark it running (M1.2).
      if ((record.status as K8sJobExecutionRecord['status']) === 'cancelled') {
        record.logs.push(`[${new Date().toISOString()}] Cancelled while the manifest was being applied; deleting the Kubernetes Job.`);
        await execAsync(`kubectl delete job ${record.k8sJobName} -n carbonroute-jobs --ignore-not-found`).catch((err: any) => {
          record.logs.push(`[${new Date().toISOString()}] Could not delete the Kubernetes Job: ${err.message}`);
        });
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        return;
      }
      record.status = 'running';
      const startTime = new Date();
      record.startedAt = startTime.toISOString();
      record.actualStartTime = startTime.toISOString();

      // Poll pod completion
      const checkInterval = setInterval(async () => {
        if (record.status === 'cancelled') {
          clearInterval(checkInterval);
          return;
        }
        try {
          const { stdout } = await execAsync(`kubectl get job ${record.k8sJobName} -n carbonroute-jobs -o json`);
          const parsed = JSON.parse(stdout);
          if (parsed.status?.succeeded) {
            clearInterval(checkInterval);
            const compTime = new Date();
            record.status = 'completed';
            record.completedAt = compTime.toISOString();
            record.completionTime = compTime.toISOString();
            record.exitCode = 0;
            const { stdout: logOut } = await execAsync(
              `kubectl logs job/${record.k8sJobName} -n carbonroute-jobs`
            ).catch(() => ({ stdout: '' }));
            if (logOut) record.logs.push(...logOut.split('\n'));
            if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
          } else if (parsed.status?.failed) {
            clearInterval(checkInterval);
            record.status = 'failed';
            record.completionTime = new Date().toISOString();
            record.completedAt = record.completionTime;
            record.exitCode = 1;
            if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
          }
        } catch {
          // continue polling
        }
      }, 2000);
    } catch (err: any) {
      record.status = 'failed';
      record.logs.push(`[${new Date().toISOString()}] Failed to launch on Kubernetes: ${err.message}`);
    }
  }

  private static executeInSandbox(record: K8sJobExecutionRecord, durationSec: number) {
    record.status = 'scheduled';
    record.logs.push(
      `[${new Date().toISOString()}] [Simulation] Simulated execution starting (no workload process will be run).`
    );

    setTimeout(() => {
      if (record.status === 'cancelled') return;
      record.status = 'running';
      const startTime = new Date();
      record.startedAt = startTime.toISOString();
      record.actualStartTime = startTime.toISOString();
      record.logs.push(`[${startTime.toISOString()}] [Simulation: ${record.podName}] Simulated run started.`);
      record.logs.push(`[${startTime.toISOString()}] [Workload Task] Command: ${record.command}`);

      const totalEpochs = 5;
      const stepDuration = Math.max(100, Math.round((durationSec * 1000) / totalEpochs));
      let currentEpoch = 0;

      const interval = setInterval(() => {
        if (record.status === 'cancelled') {
          clearInterval(interval);
          return;
        }
        currentEpoch++;
        const pct = Math.round((currentEpoch / totalEpochs) * 100);
        record.logs.push(
          `[${new Date().toISOString()}] [Simulation] Step ${currentEpoch}/${totalEpochs} (${pct}% of simulated duration)`
        );

        if (currentEpoch >= totalEpochs) {
          clearInterval(interval);
          const compTime = new Date();
          record.status = 'completed';
          record.completedAt = compTime.toISOString();
          record.completionTime = compTime.toISOString();
          record.exitCode = 0;

          record.logs.push(
            `[${compTime.toISOString()}] [Simulation] Simulated run finished (no workload process was executed).`
          );
          record.logs.push(
            `[${compTime.toISOString()}] [CarbonRoute Accounting] Predicted window intensity: ${record.predictedCarbon} gCO2eq/kWh. Realized carbon is not simulated: collect provider observations after the scheduled window.`
          );
        }
      }, stepDuration);
    }, 200);
  }
}

// Top-level convenience exports matching specification
export function generateJobManifest(job: any, scheduledHour?: number, k8sJobName?: string): any {
  return K8sConnector.generateJobManifest(job, scheduledHour, k8sJobName);
}

export async function dispatchJob(
  jobOrId: any,
  containerImageOrDecision?: any,
  command?: string,
  cpu?: number,
  memoryMb?: number,
  predictedCarbon?: number,
  simulatedDurationSec?: number
): Promise<K8sJobExecutionRecord> {
  return K8sConnector.dispatchJob(
    jobOrId,
    containerImageOrDecision,
    command,
    cpu,
    memoryMb,
    predictedCarbon,
    simulatedDurationSec
  );
}
