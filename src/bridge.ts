import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { McpServerConfig } from "./types.js";

export async function createMcpClient(
  serverName: string,
  config: McpServerConfig,
): Promise<{ client: Client; transport: StdioClientTransport }> {
  // Filter undefined from process.env
  const cleanEnv = Object.fromEntries(
    Object.entries(process.env).filter(([_, v]) => v !== undefined),
  ) as Record<string, string>;

  // StdioClientTransport spawns internally - don't spawn manually
  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args,
    env: { ...cleanEnv, ...config.env },
    stderr: "pipe",
  });

  // Log stderr from transport
  transport.onerror = (error) => {
    console.error(`❌ [${serverName}] Error:`, error);
  };

  const client = new Client(
    {
      name: `mcp-gateway-${serverName}`,
      version: "1.0.0",
    },
    {
      capabilities: {},
    },
  );

  await client.connect(transport);
  console.log(`✅ [${serverName}] Connected`);

  return { client, transport };
}
