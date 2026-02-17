import { spawn, ChildProcess } from "child_process";
import { EventEmitter } from "events";
import {
  JSONRPCMessage,
  JSONRPCRequest,
  JSONRPCResponse,
  JSONRPCNotification,
  DesktopCommanderConfig,
  Logger,
  isJSONRPCResponse,
  isJSONRPCNotification,
} from "./types.js";

/**
 * Manages the Desktop Commander MCP subprocess
 * Handles stdio communication and message parsing
 */
export class DesktopCommanderProcess extends EventEmitter {
  private process: ChildProcess | null = null;
  private buffer: string = "";
  private config: DesktopCommanderConfig;
  private logger: Logger;
  private isStarted: boolean = false;

  constructor(config: DesktopCommanderConfig, logger: Logger) {
    super();
    this.config = config;
    this.logger = logger;
  }

  /**
   * Start the Desktop Commander subprocess
   */
  async start(): Promise<void> {
    if (this.isStarted) {
      this.logger.warn("Desktop Commander process already started");
      return;
    }

    return new Promise((resolve, reject) => {
      this.logger.info("Starting Desktop Commander subprocess...", {
        workspace: this.config.workspacePath,
      });

      try {
        // Spawn Desktop Commander using npx
        this.process = spawn(
          "npx",
          ["@wonderwhy-er/desktop-commander@latest"],
          {
            stdio: ["pipe", "pipe", "pipe"],
            env: {
              ...process.env,
              WORKSPACE_PATH: this.config.workspacePath,
              LOG_LEVEL: this.config.logLevel || "info",
            },
          },
        );

        // Handle stdout (messages from Desktop Commander)
        this.process.stdout?.on("data", (data: Buffer) => {
          this.handleStdout(data);
        });

        // Handle stderr (errors and logs from Desktop Commander)
        this.process.stderr?.on("data", (data: Buffer) => {
          const message = data.toString();
          this.logger.debug(`Desktop Commander stderr: ${message}`);
        });

        // Handle process errors
        this.process.on("error", (error: Error) => {
          this.logger.error("Desktop Commander process error:", error);
          this.emit("error", error);
          if (!this.isStarted) {
            reject(error);
          }
        });

        // Handle process exit
        this.process.on(
          "exit",
          (code: number | null, signal: string | null) => {
            this.logger.info(`Desktop Commander process exited`, {
              code,
              signal,
            });
            this.isStarted = false;
            this.process = null;
            this.emit("exit", { code, signal });
          },
        );

        // Wait a moment for process to initialize
        setTimeout(() => {
          if (this.process && !this.process.killed) {
            this.isStarted = true;
            this.logger.info(
              "Desktop Commander subprocess started successfully",
            );
            resolve();
          } else {
            reject(new Error("Desktop Commander process failed to start"));
          }
        }, 1000);
      } catch (error) {
        this.logger.error("Failed to start Desktop Commander:", error);
        reject(error);
      }
    });
  }

  /**
   * Handle stdout data from Desktop Commander
   * Parses newline-delimited JSON messages
   */
  private handleStdout(data: Buffer): void {
    this.buffer += data.toString();

    // Process complete messages (newline-delimited)
    const lines = this.buffer.split("\n");

    // Keep the last incomplete line in the buffer
    this.buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const message = JSON.parse(line) as JSONRPCMessage;
        this.logger.debug("Received message from Desktop Commander:", message);

        if (isJSONRPCResponse(message)) {
          this.emit("response", message);
        } else if (isJSONRPCNotification(message)) {
          this.emit("notification", message);
        }
      } catch (error) {
        this.logger.error("Failed to parse message from Desktop Commander:", {
          line,
          error,
        });
      }
    }
  }

  /**
   * Send a message to Desktop Commander via stdin
   */
  async sendMessage(message: JSONRPCRequest): Promise<void> {
    if (!this.process || !this.isStarted) {
      throw new Error("Desktop Commander process is not running");
    }

    if (!this.process.stdin) {
      throw new Error("Desktop Commander process stdin is not available");
    }

    const messageStr = JSON.stringify(message) + "\n";
    this.logger.debug("Sending message to Desktop Commander:", message);

    return new Promise((resolve, reject) => {
      this.process!.stdin!.write(messageStr, (error) => {
        if (error) {
          this.logger.error(
            "Failed to write to Desktop Commander stdin:",
            error,
          );
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Register callback for responses
   */
  onResponse(callback: (response: JSONRPCResponse) => void): void {
    this.on("response", callback);
  }

  /**
   * Register callback for notifications
   */
  onNotification(callback: (notification: JSONRPCNotification) => void): void {
    this.on("notification", callback);
  }

  /**
   * Register callback for errors
   */
  onError(callback: (error: Error) => void): void {
    this.on("error", callback);
  }

  /**
   * Register callback for process exit
   */
  onExit(
    callback: (info: { code: number | null; signal: string | null }) => void,
  ): void {
    this.on("exit", callback);
  }

  /**
   * Stop the Desktop Commander subprocess
   */
  async stop(): Promise<void> {
    if (!this.process || !this.isStarted) {
      this.logger.warn("Desktop Commander process is not running");
      return;
    }

    return new Promise((resolve) => {
      this.logger.info("Stopping Desktop Commander subprocess...");

      const timeout = setTimeout(() => {
        if (this.process && !this.process.killed) {
          this.logger.warn("Forcing Desktop Commander process to terminate");
          this.process.kill("SIGKILL");
        }
        resolve();
      }, 5000);

      this.process!.once("exit", () => {
        clearTimeout(timeout);
        this.isStarted = false;
        this.logger.info("Desktop Commander subprocess stopped");
        resolve();
      });

      // Try graceful shutdown first
      this.process!.kill("SIGTERM");
    });
  }

  /**
   * Check if the process is running
   */
  isRunning(): boolean {
    return this.isStarted && this.process !== null && !this.process.killed;
  }

  /**
   * Restart the Desktop Commander subprocess
   */
  async restart(): Promise<void> {
    this.logger.info("Restarting Desktop Commander subprocess...");
    await this.stop();
    await this.start();
  }
}
