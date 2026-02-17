import express, { Request, Response } from "express";
import { DesktopCommanderProcess } from "./desktop-commander.js";
import { StdioBridge } from "./bridge.js";
import { ConsoleLogger } from "./logger.js";
import {
  ServerConfig,
  JSONRPCRequest,
  JSONRPCResponse,
  JSONRPCNotification,
} from "./types.js";

/**
 * HTTP MCP Server that wraps Desktop Commander
 */
export class MCPHttpServer {
  private app: express.Application;
  private dcProcess: DesktopCommanderProcess;
  private bridge: StdioBridge;
  private logger: ConsoleLogger;
  private config: ServerConfig;
  private requestIdCounter: number = 0;

  constructor(config: ServerConfig) {
    this.config = config;
    this.logger = new ConsoleLogger(config.logLevel);
    this.app = express();

    // Initialize Desktop Commander process
    this.dcProcess = new DesktopCommanderProcess(
      {
        workspacePath: config.workspacePath,
        logLevel: config.logLevel,
      },
      this.logger,
    );

    // Initialize bridge
    this.bridge = new StdioBridge(
      this.dcProcess,
      this.logger,
      config.requestTimeout,
    );

    this.setupMiddleware();
    this.setupRoutes();
  }

  /**
   * Setup Express middleware
   */
  private setupMiddleware(): void {
    // Parse JSON bodies
    this.app.use(express.json());

    // Request logging
    this.app.use((req, res, next) => {
      this.logger.debug(`${req.method} ${req.path}`);
      next();
    });

    // CORS headers - allow all origins for MCP server
    this.app.use((req, res, next) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      if (req.method === "OPTIONS") {
        res.sendStatus(200);
      } else {
        next();
      }
    });
  }

  /**
   * Setup Express routes
   */
  private setupRoutes(): void {
    // Health check endpoint
    this.app.get("/health", (req, res) => {
      res.json({
        status: "ok",
        processRunning: this.dcProcess.isRunning(),
        pendingRequests: this.bridge.getPendingRequestCount(),
      });
    });

    // Main MCP endpoint
    this.app.post("/mcp", this.handleMCPRequest.bind(this));

    // 404 handler
    this.app.use((req, res) => {
      res.status(404).json({
        error: "Not found",
        path: req.path,
      });
    });

    // Error handler
    this.app.use(
      (error: Error, req: Request, res: Response, next: Function) => {
        this.logger.error("Express error:", error);
        res.status(500).json({
          error: "Internal server error",
          message: error.message,
        });
      },
    );
  }

  /**
   * Handle MCP JSON-RPC request
   */
  private async handleMCPRequest(req: Request, res: Response): Promise<void> {
    try {
      const body = req.body;

      // Validate JSON-RPC request
      if (!body || typeof body !== "object") {
        res.status(400).json({
          jsonrpc: "2.0",
          error: {
            code: -32600,
            message: "Invalid Request",
          },
          id: null,
        });
        return;
      }

      // Handle batch requests
      if (Array.isArray(body)) {
        const responses = await Promise.all(
          body.map((request) => this.processRequest(request)),
        );
        res.json(responses.filter((r) => r !== null));
        return;
      }

      // Handle single request
      const response = await this.processRequest(body);
      if (response !== null) {
        res.json(response);
      } else {
        // Notification - no response
        res.status(204).send();
      }
    } catch (error) {
      this.logger.error("Error handling MCP request:", error);
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal error",
          data: error instanceof Error ? error.message : String(error),
        },
        id: null,
      });
    }
  }

  /**
   * Process a single JSON-RPC request
   */
  private async processRequest(request: any): Promise<JSONRPCResponse | null> {
    // Check if it's a notification (no id)
    const isNotification = !("id" in request);

    try {
      // Validate basic JSON-RPC structure
      if (request.jsonrpc !== "2.0" || !request.method) {
        return {
          jsonrpc: "2.0",
          error: {
            code: -32600,
            message: "Invalid Request",
          },
          id: request.id || null,
        };
      }

      // Handle special methods that don't need Desktop Commander
      if (request.method === "ping") {
        return isNotification
          ? null
          : {
              jsonrpc: "2.0",
              result: { pong: true },
              id: request.id,
            };
      }

      // Forward request to Desktop Commander via bridge
      const dcRequest: JSONRPCRequest = {
        jsonrpc: "2.0",
        method: request.method,
        params: request.params,
        id: request.id || this.generateRequestId(),
      };

      const response = await this.bridge.sendRequest(dcRequest);

      // Return null for notifications
      return isNotification ? null : response;
    } catch (error) {
      if (isNotification) {
        // Don't respond to notifications even on error
        this.logger.error("Error processing notification:", error);
        return null;
      }

      return {
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : "Internal error",
          data: error instanceof Error ? error.stack : undefined,
        },
        id: request.id || null,
      };
    }
  }

  /**
   * Generate a unique request ID
   */
  private generateRequestId(): string {
    return `http-${Date.now()}-${++this.requestIdCounter}`;
  }

  /**
   * Start the server
   */
  async start(): Promise<void> {
    // Start Desktop Commander process
    this.logger.info("Starting Desktop Commander process...");
    await this.dcProcess.start();

    // Start HTTP server
    return new Promise((resolve) => {
      this.app.listen(this.config.port, () => {
        this.logger.info(
          `MCP HTTP Server listening on port ${this.config.port}`,
        );
        this.logger.info(`Workspace path: ${this.config.workspacePath}`);
        this.logger.info(
          "Health check: http://localhost:" + this.config.port + "/health",
        );
        this.logger.info(
          "MCP endpoint: http://localhost:" + this.config.port + "/mcp",
        );
        resolve();
      });
    });
  }

  /**
   * Stop the server
   */
  async stop(): Promise<void> {
    this.logger.info("Stopping MCP HTTP Server...");

    // Stop Desktop Commander process
    await this.dcProcess.stop();

    this.logger.info("Server stopped");
  }
}

/**
 * Main entry point
 */
async function main() {
  // Load configuration from environment variables
  const config: ServerConfig = {
    port: parseInt(process.env.PORT || "8081", 10),
    workspacePath: process.env.WORKSPACE_PATH || "/workspace",
    logLevel: (process.env.LOG_LEVEL as any) || "info",
    requestTimeout: parseInt(process.env.REQUEST_TIMEOUT || "30000", 10),
  };

  const server = new MCPHttpServer(config);

  // Handle graceful shutdown
  const shutdown = async () => {
    console.log("\nShutdown signal received");
    await server.stop();
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  // Start server
  try {
    await server.start();
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

// Run if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}

export default MCPHttpServer;
