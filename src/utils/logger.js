// Lightweight namespaced logger.
//
// Production builds drop debug/info messages entirely; warn/error always pass
// through. Each module creates its own logger with a stable tag so logs can
// be filtered in DevTools (e.g. "[MAVLink]", "[BLE]", "[UDP]").
//
// Usage:
//   import { createLogger } from "@/utils/logger";
//   const log = createLogger("MAVLink");
//   log.debug("first msg id=%d", 33);

const isDev = import.meta.env.DEV;

export function createLogger(tag) {
  const prefix = `[${tag}]`;
  return {
    debug: isDev ? console.log.bind(console, prefix)  : noop,
    info:  isDev ? console.info.bind(console, prefix) : noop,
    warn:  console.warn.bind(console, prefix),
    error: console.error.bind(console, prefix),
  };
}

function noop() {}
