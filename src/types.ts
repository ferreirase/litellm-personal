/**
 * JSON-RPC 2.0 Types
 */

export interface JSONRPCRequest {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
  id: string | number;
}

export interface JSONRPCResponse {
  jsonrpc: "2.0";
  result?: unknown;
  error?: JSONRPCError;
  id: string | number | null;
}

export interface JSONRPCNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

export interface JSONRPCError {
  code: number;
  message: string;
  data?: unknown;
}

export type JSONRPCMessage =
  | JSONRPCRequest
  | JSONRPCResponse
  | JSONRPCNotification;

/**
 * MCP Protocol Types
 */

export interface MCPInitializeParams {
  protocolVersion: string;
  capabilities: Record<string, unknown>;
  clientInfo: {
    name: string;
    version: string;
  };
}

export interface MCPToolCallParams {
  name: string;
  arguments?: Record<string, unknown>;
}

export interface MCPListToolsResult {
  tools: MCPTool[];
}

export interface MCPTool {
  name: string;
  description?: string;
  inputSchema: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * Desktop Commander Configuration
 */

export interface DesktopCommanderConfig {
  workspacePath: string;
  logLevel?: "debug" | "info" | "warn" | "error";
}

/**
 * Bridge Types
 */

export interface PendingRequest {
  resolve: (response: JSONRPCResponse) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

/**
 * Server Configuration
 */

export interface ServerConfig {
  port: number;
  workspacePath: string;
  logLevel: "debug" | "info" | "warn" | "error";
  requestTimeout: number; // in milliseconds
}

/**
 * Type guards
 */

export function isJSONRPCRequest(
  message: JSONRPCMessage,
): message is JSONRPCRequest {
  return "id" in message && message.id !== undefined;
}

export function isJSONRPCResponse(
  message: JSONRPCMessage,
): message is JSONRPCResponse {
  return "id" in message && ("result" in message || "error" in message);
}

export function isJSONRPCNotification(
  message: JSONRPCMessage,
): message is JSONRPCNotification {
  return !("id" in message);
}

/**
 * Logger interface
 */

export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}
