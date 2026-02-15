import { spawn, ChildProcess } from "child_process";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";

export class StdioBridge {
  private process: ChildProcess | null = null;
  private messageId = 1;
  private pendingRequests = new Map<number, (res: any) => void>();
  private buffer = "";
  private hostRoot: string;
  private containerData: string;

  constructor(private command: string, private args: string[], private env: Record<string, string> = {}) {
    this.hostRoot = process.env.HOST_ROOT || "/home/ferreirase/Documents";
    this.containerData = "/data";
  }

  /**
   * Recursively converts host paths to container paths in parameters
   */
  private convertPathsToContainer(params: any): any {
    if (typeof params === 'string' && params.startsWith(this.hostRoot)) {
      return params.replace(this.hostRoot, this.containerData);
    }
    
    if (Array.isArray(params)) {
      return params.map(item => this.convertPathsToContainer(item));
    }
    
    if (typeof params === 'object' && params !== null) {
      const converted: any = {};
      for (const [key, value] of Object.entries(params)) {
        converted[key] = this.convertPathsToContainer(value);
      }
      return converted;
    }
    
    return params;
  }

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
    
    // Note: notifications/initialized is not required for MCP 2024-11-05
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
        inputSchema: z.object({}).passthrough(), // Accept any object properties
        execute: async (input) => {
          // Convert host paths to container paths before sending
          const convertedInput = this.convertPathsToContainer(input);
          
          const res = await this.request("tools/call", {
            name: tool.name,
            arguments: convertedInput,
          });
          if (res.error) throw new Error(res.error.message);
          return res.result;
        },
      });
    }

    return tools;
  }
}
