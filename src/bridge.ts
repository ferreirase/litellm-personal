
import { spawn, ChildProcess } from "child_process";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";

export class StdioBridge {
  private process: ChildProcess | null = null;
  private messageId = 1;
  private pendingRequests = new Map<number, (res: any) => void>();
  private buffer = "";

  constructor(private command: string, private args: string[], private env: Record<string, string> = {}) {}

  async start(): Promise<void> {
    console.log(`🚀 Starting Stdio Bridge: ${this.command} ${this.args.join(" ")}`);
    this.process = spawn(this.command, this.args, {
      env: { ...process.env, ...this.env },
      shell: true,
    });

    this.process.stdout?.on("data", (data) => {
      this.buffer += data.toString();
      this.processBuffer();
    });

    this.process.stderr?.on("data", (data) => {
      console.error(`[${this.command} ERR] ${data}`);
    });

    // Send initialize request
    await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "Mastra-Hub", version: "1.0.0" },
    });
    
    await this.request("notifications/initialized", {});
  }

  private processBuffer() {
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const message = JSON.parse(line);
        if (message.id !== undefined) {
          const resolve = this.pendingRequests.get(message.id);
          if (resolve) {
            resolve(message);
            this.pendingRequests.delete(message.id);
          }
        }
      } catch (err) {
        // Not a JSON line, maybe a partial or log
      }
    }
  }

  async request(method: string, params: any): Promise<any> {
    if (!this.process) await this.start();
    
    const id = this.messageId++;
    const request = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
    
    return new Promise((resolve) => {
      this.pendingRequests.set(id, resolve);
      this.process?.stdin?.write(request);
    });
  }

  async listTools(): Promise<any[]> {
    const res = await this.request("tools/list", {});
    return res.result?.tools || [];
  }

  /**
   * Dynamically creates Mastra tools from the remote MCP tools.
   */
  async getMastraTools(): Promise<Record<string, any>> {
    const remoteTools = await this.listTools();
    const tools: Record<string, any> = {};

    for (const tool of remoteTools) {
      tools[tool.name] = createTool({
        id: tool.name,
        description: tool.description,
        inputSchema: z.any(), // We trust the remote tool's schema
        execute: async (input) => {
          const res = await this.request("tools/call", {
            name: tool.name,
            arguments: input,
          });
          if (res.error) throw new Error(res.error.message);
          return res.result;
        },
      });
    }

    return tools;
  }
}
