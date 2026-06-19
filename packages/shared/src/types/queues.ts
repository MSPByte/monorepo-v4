export const QUEUES = {
  FETCH: "fetch",
  NORMALIZE: "normalize",
  PROJECT: "project",
  CORRELATE: "correlate",
  CANONICAL: "canonical",
  POLICY: "policy",
  LINK: "link",
  ENRICH: "enrich",
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export function orgQueueName(queue: QueueName, orgId: string): string {
  return `${queue}__${orgId}`;
}

export function ingestionRootJobId(
  linkId: string,
  ingestRunId: string,
): string {
  return `ingest_${linkId}_${ingestRunId}`;
}
