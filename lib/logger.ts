type LogPayload = Record<string, unknown>;

function write(
  level: "info" | "warn" | "error",
  payload: LogPayload,
  message: string,
) {
  const entry = {
    level,
    message,
    ...payload,
  };
  if (level === "error") {
    console.error(entry);
    return;
  }
  if (level === "warn") {
    console.warn(entry);
    return;
  }
  console.log(entry);
}

export const logger = {
  info(payload: LogPayload, message: string) {
    write("info", payload, message);
  },
  warn(payload: LogPayload, message: string) {
    write("warn", payload, message);
  },
  error(payload: LogPayload, message: string) {
    write("error", payload, message);
  },
};
