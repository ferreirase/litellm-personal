import express, { Request, Response } from "express";
import { DesktopCommanderProcess } from "./desktop-commander.js";
import { StdioBridge } from "./bridge.js";
import { ConsoleLogger } from "./logger.js";
import {
  ServerConfig,
  JSONRPCRequest,
  JSONRPCResponse,
} from "./types.js";

/**
 * HTTP MCP Server that wraps Desktop Commander
 * Implements Streamable HTTP transport according to MCP spec 2025-03-26
 */
export class MCPHttpServer {
  private app: express.Application;
  private dcProcess: DesktopCommanderProcess;
  private bridge: StdioBridge;
  private logger: ConsoleLogger;
  private config: ServerConfig;
  private requestIdCounter: number = 0;
  private sseClients: Map<string, Response> = new Map();
  private sessionId: string | null = null;

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
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, DELETE");

      // Dynamically allow all requested headers
      const requestedHeaders = req.headers["access-control-request-headers"];
      if (requestedHeaders) {
        res.setHeader("Access-Control-Allow-Headers", requestedHeaders);
      } else {
        res.setHeader("Access-Control-Allow-Headers", "*");
      }

      // CRITICAL: Expose Mcp-Session-Id header so Inspector can read it
      // Without this, browser blocks access to the header even if server sends it
      res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");

      if (req.method === "OPTIONS") {
        res.sendStatus(200);
      } else {
        next();
      }
    });
  }

  /**
   * Setup Express routes following MCP Streamable HTTP spec
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

    // GET /mcp - SSE stream for server-initiated messages (optional per spec)
    this.app.get("/mcp", (req, res) => {
      this.logger.info("SSE stream opened");

      // Set SSE headers
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
      });

      // Generate session ID
      const sessionId = `sse-${Date.now()}-${Math.random()}`;
      this.sseClients.set(sessionId, res);

      // Keep connection alive with heartbeat
      const heartbeat = setInterval(() => {
        try {
          res.write(`:heartbeat\n\n`);
        } catch (error) {
          clearInterval(heartbeat);
          this.sseClients.delete(sessionId);
        }
      }, 30000);

      // Handle client disconnect
      req.on("close", () => {
        this.logger.info(`SSE stream closed: ${sessionId}`);
        clearInterval(heartbeat);
        this.sseClients.delete(sessionId);
      });
    });

    // POST /mcp - Handle JSON-RPC messages
    this.app.post("/mcp", this.handleMCPRequest.bind(this));

    // DELETE /mcp - Session termination (optional per spec)
    this.app.delete("/mcp", (req, res) => {
      const sessionId = req.headers["mcp-session-id"];
      this.logger.info(`Session termination requested: ${sessionId}`);
      res.status(204).send();
    });

    // 404 handler
    this.app.use((req, res) => {
      res.status(404).json({
        error: "Not found",
        path: req.path,
      });
    });

    // Error handler
    this.app.use((error: Error, req: Request, res: Response) => {
      this.logger.error("Express error:", error);
      if (!res.headersSent) {
        res.status(500).json({
          error: "Internal server error",
          message: error.message,
        });
      }
    });
  }

  /**
   * Handle MCP JSON-RPC request according to Streamable HTTP spec
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

      // Check Accept header (spec requirement)
      const accept = req.headers.accept || "";
      const acceptsJson = accept.includes("application/json");
      const acceptsSSE = accept.includes("text/event-stream");

      // Handle batch requests
      if (Array.isArray(body)) {
        const responses = await Promise.all(
          body.map((request) => this.processRequest(request)),
        );
        const validResponses = responses.filter((r) => r !== null);

        if (validResponses.length === 0) {
          // All notifications
          res.status(202).send();
        } else {
          res.json(validResponses);
        }
        return;
      }

      // Handle single request
      const isNotification = !("id" in body);
      const isRequest = "method" in body && "id" in body;

      // Process the message
      const response = await this.processRequest(body);

      // Per spec: notifications/responses return 202 Accepted
      if (isNotification || !isRequest) {
        res.status(202).send();
        return;
      }

      // Generate session ID on initialize (if not already set)
      if (body.method === "initialize" && !this.sessionId) {
        this.sessionId = `sess-${Date.now()}-${Math.random().toString(36).substring(7)}`;
        this.logger.info(`Session created: ${this.sessionId}`);
      }

      // Add session ID header to response if we have one
      if (this.sessionId) {
        res.setHeader("Mcp-Session-Id", this.sessionId);
      }

      // For requests, can return either JSON or SSE
      // Inspector should support both, but let's prefer JSON for simplicity
      if (acceptsJson || !acceptsSSE) {
        // Direct JSON response
        res.json(response);
      } else {
        // SSE stream response
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "Access-Control-Allow-Origin": "*",
        });

        // Send response as SSE event
        res.write(`data: ${JSON.stringify(response)}\n\n`);
        res.end();
      }
    } catch (error) {
      this.logger.error("Error handling MCP request:", error);
      if (!res.headersSent) {
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
        this.logger.info("Transport: Streamable HTTP (MCP spec 2025-03-26)");
        resolve();
      });
    });
  }

  /**
   * Stop the server
   */
  async stop(): Promise<void> {
    this.logger.info("Stopping MCP HTTP Server...");

    // Close all SSE connections
    this.sseClients.forEach((client) => {
      try {
        client.end();
      } catch (error) {
        // Ignore errors on close
      }
    });
    this.sseClients.clear();

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
