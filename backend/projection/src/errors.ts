export type SerializedError = {
  name: string;
  message: string;
  stack?: string;
  cause?: unknown;
};

export function serializeError(error: unknown): SerializedError {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause: error.cause,
    };
  }

  return {
    name: "Error",
    message: String(error),
  };
}
