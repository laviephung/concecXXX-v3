// src/utils/logger.ts

type Level = "INFO" | "WARN" | "ERROR" | "SUCCESS";

function log(level: Level, module: string, message: string) {
  const time = new Date().toLocaleTimeString("vi-VN");
  const icons: Record<Level, string> = {
    INFO: "ℹ️ ",
    WARN: "⚠️ ",
    ERROR: "❌",
    SUCCESS: "✅",
  };
  console.log(`[${time}] ${icons[level]} [${module}] ${message}`);
}

export function createLogger(module: string) {
  return {
    info: (msg: string) => log("INFO", module, msg),
    warn: (msg: string) => log("WARN", module, msg),
    error: (msg: string) => log("ERROR", module, msg),
    success: (msg: string) => log("SUCCESS", module, msg),
  };
}
