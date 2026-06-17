export type LogLevel = "trace" | "info" | "warn" | "error" | "fatal";

export type APIError = {
  module: string;
  context: string;
  message: string;
  time?: string;
};

export type APIResponse<T> =
  | { data: T; error?: undefined; meta?: Record<string, unknown> }
  | { data?: undefined; error: APIError; meta?: Record<string, unknown> };

interface LogInfo {
  module: string;
  context: string;
  message: string;
  meta?: Record<string, unknown>;
  err?: unknown;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  trace: 0,
  info: 1,
  warn: 2,
  error: 3,
  fatal: 4,
};

function format(level: LogLevel, info: LogInfo): string {
  const time = new Date().toLocaleTimeString();
  return `[${time}][${level.toUpperCase()}][${info.module}][${info.context}] ${info.message}`;
}

function extractStack(err: unknown): string | undefined {
  if (err instanceof Error && err.stack) return err.stack;
  return undefined;
}

export class Logger {
  static level: LogLevel = "trace";

  static trace(info: LogInfo): void {
    if (LEVEL_ORDER["trace"] < LEVEL_ORDER[Logger.level]) return;
    console.debug(format("trace", info));
  }

  static info(info: LogInfo): void {
    if (LEVEL_ORDER["info"] < LEVEL_ORDER[Logger.level]) return;
    console.info(format("info", info));
  }

  static warn(info: LogInfo): void {
    if (LEVEL_ORDER["warn"] < LEVEL_ORDER[Logger.level]) return;
    console.warn(format("warn", info));
  }

  static error(info: LogInfo): { error: APIError } {
    if (LEVEL_ORDER["error"] >= LEVEL_ORDER[Logger.level]) {
      const stack = extractStack(info.err);
      console.error(format("error", info), stack ? `\n${stack}` : "");
    }
    return {
      error: {
        module: info.module,
        context: info.context,
        message: info.message,
        time: new Date().toISOString(),
      },
    };
  }

  static fatal(info: LogInfo): { error: APIError } {
    if (LEVEL_ORDER["fatal"] >= LEVEL_ORDER[Logger.level]) {
      const stack = extractStack(info.err);
      console.error(format("fatal", info), stack ? `\n${stack}` : "");
    }
    return {
      error: {
        module: info.module,
        context: info.context,
        message: info.message,
        time: new Date().toISOString(),
      },
    };
  }
}
