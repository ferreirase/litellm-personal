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
    "path",
    "file_path",
    "filePath",
    "filepath",
    "directory",
    "dir",
    "folder",
    "source",
    "destination",
    "dest",
    "oldPath",
    "newPath",
    "from",
    "to",
    "source_path",
    "target_path",
    "working_directory",
    "cwd",
    "absolute_path",
    "relative_path",
  ];

  /**
   * Recursively converts paths to container format
   * Only converts values for known path keys, leaves other strings untouched
   */
  private convertAllPathsToContainer(params: any, key?: string): any {
    // If it's a string and the key is a known path field, convert it
    if (typeof params === "string") {
      if (key && this.pathKeys.includes(key)) {
        return this.convertSinglePath(params);
      }
      return params;
    }

    if (Array.isArray(params)) {
      return params.map((item, index) =>
        this.convertAllPathsToContainer(item, `${key}[${index}]`),
      );
    }

    if (typeof params === "object" && params !== null) {
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
    if (!path.isAbsolute(inputPath) || inputPath.startsWith(".")) {
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
      console.log(
        `🔄 [${this.options.command}] Path ${type}: "${from}" → "${to}"`,
      );
    }
  }

  async start(): Promise<void> {
    console.log(
      `🚀 Starting Stdio Bridge: ${this.options.command} ${this.options.args.join(" ")}`,
    );
    console.log(`   Base Path: ${this.basePath}`);
    console.log(
      `   Host Root: ${this.hostRoot} → Container: ${this.containerData}`,
    );
    console.log(`   Debug Mode: ${this.debug ? "ON" : "OFF"}`);

    // Use shell: false for backlog, true for others
    const useShell = this.options.command !== "backlog";

    this.process = spawn(this.options.command, this.options.args, {
      env: {
        ...process.env,
        ...this.options.env,
        HOST_ROOT: this.hostRoot,
        CONTAINER_DATA: this.containerData,
      },
      shell: useShell,
      cwd: this.basePath,
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

    // Wait for process to be ready (especially important for backlog)
    if (this.debug) {
      console.log(`   Waiting ${500}ms for process to be ready...`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Send initialize request
    if (this.debug) {
      console.log(`   Sending initialize request...`);
    }
    await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "Mastra-Hub", version: "1.0.0" },
    });
    if (this.debug) {
      console.log(`   Initialize request sent, waiting for response...`);
    }
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
    const request =
      JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";

    if (this.debug) {
      console.log(`   → Request: ${method}`);
      console.log(`      Body: ${request}`);
    }

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, resolve);

      // Add timeout to avoid hanging requests
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout after 30000ms: ${method}`));
      }, 30000);

      // Wrapper to clear timeout when response arrives
      const originalResolve = resolve;
      this.pendingRequests.set(id, (data: any) => {
        clearTimeout(timeout);
        originalResolve(data);
      });

      if (this.debug) {
        console.log(`   Writing to stdin: ${request}`);
      }
      this.process?.stdin?.write(request);
    });
  }

  async listTools(): Promise<any[]> {
    if (this.debug) {
      console.log(`   Calling tools/list...`);
    }
    const res = await this.request("tools/list", {});
    if (this.debug) {
      console.log(`   Response received:`, res);
      console.log(`   Tools in response:`, res?.result?.tools);
    }
    const tools = res.result?.tools || [];
    if (this.debug) {
      console.log(`   Returning ${tools.length} tools`);
    }
    return tools;
  }

  /**
   * Dynamically creates Mastra tools from the remote MCP tools.
   */
  async getMastraTools(): Promise<Record<string, any>> {
    const remoteTools = await this.listTools();
    const tools: Record<string, any> = {};

    console.log(
      `🔧 [${this.options.command}] Creating ${remoteTools.length} Mastra tools...`,
    );

    for (const tool of remoteTools) {
      console.log(`   Creating tool: ${tool.name}`);

      tools[tool.name] = createTool({
        id: tool.name,
        description: tool.description,
        inputSchema: z.object({}).passthrough(),
        execute: async (input: any, context: any) => {
          // EXTENSIVE DEBUG LOGGING - Phase 1 Diagnosis
          console.log(
            `\n🔍 [${this.options.command}] TOOL CALL DEBUG: ${tool.name}`,
          );
          console.log(
            `═══════════════════════════════════════════════════════`,
          );
          console.log(`1. Raw input parameter:`);
          console.log(`   Type: ${typeof input}`);
          console.log(`   Value: ${JSON.stringify(input, null, 2)}`);
          console.log(`   Is null: ${input === null}`);
          console.log(`   Is undefined: ${input === undefined}`);
          console.log(`   Is object: ${typeof input === "object"}`);

          if (input && typeof input === "object") {
            console.log(`   Keys: [${Object.keys(input).join(", ")}]`);
            console.log(`   Has 'arguments' key: ${"arguments" in input}`);
            console.log(`   Has 'params' key: ${"params" in input}`);

            if ("arguments" in input) {
              console.log(
                `   input.arguments: ${JSON.stringify(input.arguments)}`,
              );
            }
          }

          console.log(`\n2. Context parameter:`);
          console.log(`   Type: ${typeof context}`);
          console.log(`   Value: ${JSON.stringify(context, null, 2)}`);

          // Check if params are in input.arguments (MCP format) or directly in input
          let actualParams = input;
          if (
            input &&
            typeof input === "object" &&
            "arguments" in input &&
            input.arguments
          ) {
            console.log(
              `\n3. Detected MCP format - extracting from input.arguments`,
            );
            actualParams = input.arguments;
          } else if (
            input &&
            typeof input === "object" &&
            Object.keys(input).length === 0
          ) {
            console.log(
              `\n3. Input is empty object - checking if params are elsewhere`,
            );
            // Try to find params in context or other locations
            if (context && typeof context === "object") {
              console.log(
                `   Context keys: [${Object.keys(context).join(", ")}]`,
              );
              if ("params" in context) {
                actualParams = context.params;
                console.log(
                  `   Found params in context: ${JSON.stringify(actualParams)}`,
                );
              }
            }
          }

          console.log(`\n4. Actual params to use:`);
          console.log(`   Type: ${typeof actualParams}`);
          console.log(`   Value: ${JSON.stringify(actualParams, null, 2)}`);
          console.log(
            `   Keys: [${Object.keys((actualParams as any) || {}).join(", ")}]`,
          );
          console.log(
            `═══════════════════════════════════════════════════════\n`,
          );

          if (!actualParams || Object.keys(actualParams as any).length === 0) {
            console.error(
              `❌ [${this.options.command}] ERROR: No valid parameters found for ${tool.name}`,
            );
            throw new Error(
              `Empty or invalid input received for tool ${tool.name}`,
            );
          }

          // Convert all paths to container format
          const convertedInput = this.convertAllPathsToContainer(actualParams);

          console.log(`   Converted Input: ${JSON.stringify(convertedInput)}`);

          const res = await this.request("tools/call", {
            name: tool.name,
            arguments: convertedInput,
          });

          console.log(
            `📥 [${this.options.command}] Response: ${JSON.stringify(res).substring(0, 200)}...`,
          );

          if (res.error) {
            console.error(
              `❌ [${this.options.command}] Tool error:`,
              res.error,
            );
            throw new Error(res.error.message);
          }

          return res.result;
        },
      });
    }

    console.log(
      `✅ [${this.options.command}] Created ${Object.keys(tools).length} tools`,
    );
    return tools;
  }

  stop(): void {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
  }
}
