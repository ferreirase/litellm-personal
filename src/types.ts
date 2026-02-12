export interface McpServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export interface McpConfig {
  servers: Record<string, McpServerConfig>;
}

export interface McpSession {
  serverName: string;
  sessionId: string;
  client: any;
  transport: any;
  createdAt: number;
}
