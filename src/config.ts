import { readFileSync, existsSync } from "fs";
import { McpConfig } from "./types.js";

const CONFIG_PATH = process.env.MCP_CONFIG_PATH || "/app/mcp-config.json";

export function loadConfig(): McpConfig {
  if (!existsSync(CONFIG_PATH)) {
    throw new Error(`Config not found: ${CONFIG_PATH}`);
  }

  const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));

  // Interpolate ${ENV_VAR} in config
  const interpolate = (str: string): string =>
    str.replace(/\$\{(\w+)\}/g, (_, key) => process.env[key] || "");

  Object.values(raw.servers).forEach((srv: any) => {
    if (srv.cwd) srv.cwd = interpolate(srv.cwd);
    srv.args = srv.args.map(interpolate);
    if (srv.env) {
      Object.keys(srv.env).forEach((k) => {
        srv.env[k] = interpolate(srv.env[k]);
      });
    }
  });

  return raw as McpConfig;
}
