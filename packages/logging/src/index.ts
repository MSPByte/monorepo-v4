import pino from "pino";

export interface Logger {
  trace(msg: string, data?: Record<string, unknown>): void;
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
  critical(msg: string, data?: Record<string, unknown>): void;
}

export function createLogger(name: string, level?: string): Logger {
  const inner = pino({ name, level: level ?? "info" });

  return {
    trace: (msg, data) => inner.trace(data ?? {}, msg),
    debug: (msg, data) => inner.debug(data ?? {}, msg),
    info: (msg, data) => inner.info(data ?? {}, msg),
    warn: (msg, data) => inner.warn(data ?? {}, msg),
    error: (msg, data) => inner.error(data ?? {}, msg),
    critical: (msg, data) => inner.fatal(data ?? {}, msg),
  };
}
