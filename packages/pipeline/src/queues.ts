export const QUEUES = {
  INGEST: "ingest",
  NORMALIZE: "normalize",
  POLICY: "policy",
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export function assertBullMqName(name: string, label = "BullMQ name"): string {
  if (name.includes(":")) {
    throw new Error(`${label} cannot contain ':'`);
  }

  return name;
}

export function orgQueueName(queue: QueueName, orgId: string): string {
  return assertBullMqName(`${queue}__${orgId}`, "BullMQ queue name");
}

export function pipelineJobPriority(provider: string): number {
  return provider === "microsoft-365" ? 10 : 1;
}

export function ingestionRootJobId(linkId: string, ingestionRunId: string): string {
  return assertBullMqName(`ingest_${linkId}_${ingestionRunId}`, "BullMQ job id");
}

// Deterministic ID for the "next scheduled run" of a (link, facet). Delayed
// jobs enqueued by the worker or safety-net poller use this ID so BullMQ
// dedupes redundant enqueue attempts (worker completes + poller runs =
// still one delayed job).
export function nextIngestionJobId(linkId: string, facet: string): string {
  return assertBullMqName(`next_ingest_${linkId}_${facet}`, "BullMQ job id");
}
