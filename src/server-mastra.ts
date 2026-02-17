import "dotenv/config";
import express from "express";
import cors from "cors";
import { randomUUID } from "crypto";
import { MCPServer } from "@mastra/mcp";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createTool } from "@mastra/core/tools";
import { DesktopCommanderProcess } from "./desktop-commander.js";
import { ConsoleLogger } from "./logger.js";

const PORT = parseInt(process.env.PORT || "8081", 10);
const WORKSPACE_PATH = process.env.WORKSPACE_PATH || "/workspace";
const LOG_LEVEL = (process.env.LOG_LEVEL as any) || "info";

const logger = new ConsoleLogger(LOG_LEVEL);
const app = express();

// CORS configuration
app.use(
  cors({
    origin: "*",
    exposedHeaders: ["Mcp-Session-Id"],
  }),
);
app.use(express.json());

// Session store
const sessions = new Map<string, StreamableHTTPServerTransport>();

// Desktop Commander process
const dcProcess = new DesktopCommanderProcess(
  {
    workspacePath: WORKSPACE_PATH,
    logLevel: LOG_LEVEL,
  },
  logger,
);

// Tool cache - we'll load Desktop Commander's actual tools
let toolCache: Record<string, any> = {};

async function loadDesktopCommanderTools() {
  logger.info("Loading Desktop Commander tools...");

  try {
    // Start the Desktop Commander process
    await dcProcess.start();

    // Send tools/list request to get all available tools
    const response = await sendToDesktopCommander({
      jsonrpc: "2.0",
      method: "tools/list",
      params: {},
      id: 1,
    });

    if (response.result?.tools) {
      // Convert Desktop Commander tools to Mastra tools
      for (const dcTool of response.result.tools) {
        // Create Mastra tool that proxies to Desktop Commander
        // Pass inputSchema directly as JSON schema (not Zod)
        toolCache[dcTool.name] = createTool({
          id: dcTool.name,
          description: dcTool.description || "",
          inputSchema: dcTool.inputSchema,
          execute: async (params: any) => {
            // Forward to Desktop Commander
            const result = await sendToDesktopCommander({
              jsonrpc: "2.0",
              method: "tools/call",
              params: {
                name: dcTool.name,
                arguments: params,
              },
              id: Math.random(),
            });

            return result.result;
          },
        });
      }

      logger.info(`Loaded ${Object.keys(toolCache).length} tools from Desktop Commander`);
    }
  } catch (error) {
    logger.error("Failed to load Desktop Commander tools:", error);
    throw error;
  }
}

// Helper to send messages to Desktop Commander
let messageIdCounter = 0;
const pendingRequests = new Map<string | number, any>();

// Set up response handler
dcProcess.onResponse((response) => {
  if (response.id && pendingRequests.has(response.id)) {
    const { resolve } = pendingRequests.get(response.id)!;
    pendingRequests.delete(response.id);
    resolve(response);
  }
});

function sendToDesktopCommander(message: any): Promise<any> {
  return new Promise(async (resolve, reject) => {
    const id = message.id || ++messageIdCounter;
    pendingRequests.set(id, { resolve, reject });

    try {
      await dcProcess.sendMessage({ ...message, id });
    } catch (error) {
      pendingRequests.delete(id);
      reject(error);
      return;
    }

    // Timeout after 30s
    setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        reject(new Error("Request timeout"));
      }
    }, 30000);
  });
}

// MCP Route
app.all("/mcp", async (req, res) => {
  try {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    let transport: StreamableHTTPServerTransport | undefined;

    logger.debug(
      `${req.method} /mcp${sessionId ? ` (session: ${sessionId})` : ""}`,
    );

    if (sessionId && sessions.has(sessionId)) {
      // Existing session
      transport = sessions.get(sessionId);
    } else if (
      !sessionId &&
      req.method === "POST" &&
      req.body?.method === "initialize"
    ) {
      // New session - initialize
      logger.info(`Creating new MCP session with ${Object.keys(toolCache).length} tools`);

      const server = new MCPServer({
        id: `desktop-commander-${randomUUID()}`,
        name: "Desktop Commander MCP Server",
        version: "1.0.0",
        tools: toolCache,
      });

      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          logger.info(`Session initialized: ${sid}`);
          sessions.set(sid, transport!);
        },
      });

      transport.onclose = () => {
        const sid = transport!.sessionId;
        if (sid && sessions.has(sid)) {
          logger.info(`Session closed: ${sid}`);
          sessions.delete(sid);
        }
      };

      const sdkServer = server.getServer();
      await sdkServer.connect(transport);
    } else {
      // Invalid request
      logger.error("Invalid request - no valid session");
      return res.status(400).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Bad Request: No valid session ID provided",
        },
        id: null,
      });
    }

    if (transport) {
      await transport.handleRequest(req, res, req.body);
    }
  } catch (err: any) {
    logger.error("Error handling request:", err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal server error",
        },
        id: null,
      });
    }
  }
});

// Health check
app.get("/health", (req, res) => {
  res.json({
    name: "Desktop Commander MCP Server",
    version: "1.0.0",
    status: "online",
    tools: Object.keys(toolCache).length,
    activeSessions: sessions.size,
    workspace: WORKSPACE_PATH,
  });
});

// Start server
async function start() {
  try {
    await loadDesktopCommanderTools();

    app.listen(PORT, "0.0.0.0", () => {
      logger.info(`MCP Server listening on port ${PORT}`);
      logger.info(`Workspace: ${WORKSPACE_PATH}`);
      logger.info(`Endpoint: http://localhost:${PORT}/mcp`);
      logger.info(`Health: http://localhost:${PORT}/health`);
    });
  } catch (err) {
    logger.error("Failed to start server:", err);
    process.exit(1);
  }
}

// Graceful shutdown
process.on("SIGTERM", async () => {
  logger.info("Shutting down...");
  await dcProcess.stop();
  process.exit(0);
});

process.on("SIGINT", async () => {
  logger.info("Shutting down...");
  await dcProcess.stop();
  process.exit(0);
});

start();
