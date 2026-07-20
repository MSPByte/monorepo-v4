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
