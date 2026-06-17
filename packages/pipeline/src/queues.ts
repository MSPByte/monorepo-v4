export const QUEUES = {
  INGEST: "ingest",
  NORMALIZE: "normalize",
  PROJECT: "project",
  POLICY: "policy",
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export function orgQueueName(queue: QueueName, orgId: string): string {
  return `${queue}__${orgId}`;
}

export function ingestionRootJobId(linkId: string, ingestionRunId: string): string {
  return `ingest_${linkId}_${ingestionRunId}`;
}
