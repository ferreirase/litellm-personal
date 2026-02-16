import { spawn, ChildProcess } from "child_process";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import path from "path";

export interface StdioBridgeOptions {
  command: string;
  args: string[];
  env?: Record<string, string>;
  basePath?: string;
  debug?: boolean;
}

export class StdioBridge {
  private process: ChildProcess | null = null;
  private messageId = 1;
  private pendingRequests = new Map<number, (res: any) => void>();
  private buffer = "";
  private hostRoot: string;
  private containerData: string;
  private basePath: string;
  private debug: boolean;

  constructor(private options: StdioBridgeOptions) {
    this.hostRoot = process.env.HOST_ROOT || "/home/ferreirase/Documents";
    this.containerData = "/data";
    this.basePath = options.basePath || this.containerData;
    this.debug = options.debug || process.env.DEBUG_PATHS === "true";
  }

  /**
   * List of parameter keys that should be treated as file paths
   */
  private pathKeys = [
    'path', 'file_path', 'filePath', 'filepath',
    'directory', 'dir', 'folder',
    'source', 'destination', 'dest',
    'oldPath', 'newPath',
    'from', 'to',
    'source_path', 'target_path',
    'working_directory', 'cwd',
    'absolute_path', 'relative_path'
  ];

  /**
   * Recursively converts paths to container format
   * Only converts values for known path keys, leaves other strings untouched
   */
  private convertAllPathsToContainer(params: any, key?: string): any {
    // If it's a string and the key is a known path field, convert it
    if (typeof params === 'string') {
      if (key && this.pathKeys.includes(key)) {
        return this.convertSinglePath(params);
      }
      return params;
    }
    
    if (Array.isArray(params)) {
      return params.map((item, index) => this.convertAllPathsToContainer(item, `${key}[${index}]`));
    }
    
    if (typeof params === 'object' && params !== null) {
      const converted: any = {};
      for (const [objKey, value] of Object.entries(params)) {
        converted[objKey] = this.convertAllPathsToContainer(value, objKey);
      }
      return converted;
    }
    
    return params;
  }

  /**
   * Convert a single path to container format
   */
  private convertSinglePath(inputPath: string): string {
    // Already a container path? Keep as is
    if (inputPath.startsWith(this.containerData)) {
      this.logPathConversion(inputPath, inputPath, "already container");
      return inputPath;
    }

    // Host root path? Convert to container
    if (inputPath.startsWith(this.hostRoot)) {
      const converted = inputPath.replace(this.hostRoot, this.containerData);
      this.logPathConversion(inputPath, converted, "host→container");
      return converted;
    }

    // Relative path? Resolve against basePath
    if (!path.isAbsolute(inputPath) || inputPath.startsWith('.')) {
      const resolved = path.resolve(this.basePath, inputPath);
      this.logPathConversion(inputPath, resolved, "relative→absolute");
      return resolved;
    }

    // Absolute path not matching patterns (e.g., /tmp, /etc)
    // Return as-is but log warning
    this.logPathConversion(inputPath, inputPath, "unchanged (system path)");
    return inputPath;
  }

  /**
   * Log path conversions for debugging
   */
  private logPathConversion(from: string, to: string, type: string): void {
    if (this.debug) {
      console.log(`🔄 [${this.options.command}] Path ${type}: "${from}" → "${to}"`);
    }
  }

  async start(): Promise<void> {
    console.log(`🚀 Starting Stdio Bridge: ${this.options.command} ${this.options.args.join(" ")}`);
    console.log(`   Base Path: ${this.basePath}`);
    console.log(`   Host Root: ${this.hostRoot} → Container: ${this.containerData}`);
    console.log(`   Debug Mode: ${this.debug ? 'ON' : 'OFF'}`);

    this.process = spawn(this.options.command, this.options.args, {
      env: { 
        ...process.env, 
        ...this.options.env,
        HOST_ROOT: this.hostRoot,
        CONTAINER_DATA: this.containerData
      },
      shell: true,
      cwd: this.basePath
    });

    this.process.stdout?.on("data", (data) => {
      this.buffer += data.toString();
      this.processBuffer();
    });

    this.process.stderr?.on("data", (data) => {
      console.error(`[${this.options.command} ERR] ${data}`);
    });

    this.process.on("exit", (code) => {
      console.log(`[${this.options.command}] Process exited with code ${code}`);
    });

    // Send initialize request
    await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "Mastra-Hub", version: "1.0.0" },
    });
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
        inputSchema: z.object({}).passthrough(),
        execute: async (input) => {
          if (this.debug) {
            console.log(`📤 [${this.options.command}] Tool call: ${tool.name}`);
            console.log(`   Input: ${JSON.stringify(input)}`);
          }
          
          // Convert all paths to container format
          const convertedInput = this.convertAllPathsToContainer(input);
          
          if (this.debug && JSON.stringify(input) !== JSON.stringify(convertedInput)) {
            console.log(`   Converted: ${JSON.stringify(convertedInput)}`);
          }
          
          const res = await this.request("tools/call", {
            name: tool.name,
            arguments: convertedInput,
          });
          
          if (res.error) throw new Error(res.error.message);
          
          if (this.debug) {
            console.log(`📥 [${this.options.command}] Response received`);
          }
          
          return res.result;
        },
      });
    }

    return tools;
  }

  stop(): void {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
  }
}
