import "dotenv/config";
import express from "express";
import cors from "cors";
import { spawn, ChildProcess } from "child_process";
import { randomUUID } from "crypto";
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

// Session store - each session gets its own Desktop Commander process
interface Session {
  id: string;
  process: ChildProcess;
  buffer: string;
  messageQueue: any[];
  pendingRequests: Map<string | number, any>;
}

const sessions = new Map<string, Session>();

/**
 * Create a new Desktop Commander process for a session
 */
function createDesktopCommanderProcess(sessionId: string): Session {
  logger.info(`Creating Desktop Commander process for session ${sessionId}`);

  const dcProcess = spawn("npx", ["@wonderwhy-er/desktop-commander@latest"], {
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      WORKSPACE_PATH,
      LOG_LEVEL,
    },
  });

  const session: Session = {
    id: sessionId,
    process: dcProcess,
    buffer: "",
    messageQueue: [],
    pendingRequests: new Map(),
  };

  // Handle stdout - parse JSON-RPC messages
  dcProcess.stdout?.on("data", (data: Buffer) => {
    session.buffer += data.toString();

    const lines = session.buffer.split("\n");
    session.buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const message = JSON.parse(line);
        logger.debug(`Session ${sessionId} received:`, message);
        session.messageQueue.push(message);

        // If this is a response to a pending request, resolve it
        if (message.id !== undefined && session.pendingRequests.has(message.id)) {
          const { resolve } = session.pendingRequests.get(message.id)!;
          session.pendingRequests.delete(message.id);
          resolve(message);
        }
      } catch (error) {
        logger.error(`Session ${sessionId} failed to parse message:`, line, error);
      }
    }
  });

  // Handle stderr
  dcProcess.stderr?.on("data", (data: Buffer) => {
    logger.debug(`Session ${sessionId} stderr:`, data.toString());
  });

  // Handle process errors
  dcProcess.on("error", (error: Error) => {
    logger.error(`Session ${sessionId} process error:`, error);
  });

  // Handle process exit
  dcProcess.on("exit", (code: number | null, signal: string | null) => {
    logger.info(`Session ${sessionId} process exited`, { code, signal });
    sessions.delete(sessionId);
  });

  return session;
}

/**
 * Send a message to Desktop Commander and wait for response
 */
async function sendToDesktopCommander(
  session: Session,
  message: any,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const messageStr = JSON.stringify(message) + "\n";

    logger.debug(`Session ${session.id} sending:`, message);

    session.process.stdin?.write(messageStr, (error) => {
      if (error) {
        logger.error(`Session ${session.id} write error:`, error);
        reject(error);
      }
    });

    // For requests (with id), wait for response
    if (message.id !== undefined) {
      session.pendingRequests.set(message.id, { resolve, reject });

      // Timeout after 30s
      setTimeout(() => {
        if (session.pendingRequests.has(message.id)) {
          session.pendingRequests.delete(message.id);
          reject(new Error("Request timeout"));
        }
      }, 30000);
    } else {
      // For notifications (no id), resolve immediately
      resolve(undefined);
    }
  });
}

/**
 * Initialize a Desktop Commander session with MCP handshake
 */
async function initializeSession(session: Session): Promise<void> {
  logger.info(`Initializing session ${session.id}`);

  // Wait a bit for process to start
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Step 1: Send initialize request
  const initResponse = await sendToDesktopCommander(session, {
    jsonrpc: "2.0",
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {
        tools: {},
      },
      clientInfo: {
        name: "MCP HTTP Proxy",
        version: "1.0.0",
      },
    },
    id: 1,
  });

  logger.info(`Session ${session.id} initialized:`, initResponse.result);

  // Step 2: Send initialized notification
  await sendToDesktopCommander(session, {
    jsonrpc: "2.0",
    method: "notifications/initialized",
    params: {},
  });

  logger.info(`Session ${session.id} ready`);
}

// MCP endpoint - handles all MCP protocol messages
app.all("/mcp", async (req, res) => {
  try {
    const sessionId = (req.headers["mcp-session-id"] as string) || randomUUID();
    let session = sessions.get(sessionId);

    // Create new session if needed
    if (!session) {
      session = createDesktopCommanderProcess(sessionId);
      sessions.set(sessionId, session);

      // Initialize the session with MCP handshake
      try {
        await initializeSession(session);
      } catch (error) {
        logger.error(`Failed to initialize session ${sessionId}:`, error);
        sessions.delete(sessionId);
        return res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: "Failed to initialize Desktop Commander",
          },
          id: null,
        });
      }

      // Send session ID to client
      res.setHeader("Mcp-Session-Id", sessionId);
    }

    // Forward the request to Desktop Commander
    const body = req.body;

    if (!body || !body.jsonrpc) {
      return res.status(400).json({
        jsonrpc: "2.0",
        error: {
          code: -32600,
          message: "Invalid Request",
        },
        id: null,
      });
    }

    try {
      const response = await sendToDesktopCommander(session, body);

      if (response) {
        res.json(response);
      } else {
        // Notification - no response expected
        res.status(204).send();
      }
    } catch (error: any) {
      logger.error(`Request failed for session ${sessionId}:`, error);
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: error.message || "Internal error",
        },
        id: body.id || null,
      });
    }
  } catch (error: any) {
    logger.error("Error handling request:", error);
    res.status(500).json({
      jsonrpc: "2.0",
      error: {
        code: -32603,
        message: "Internal server error",
      },
      id: null,
    });
  }
});

// Health check
app.get("/health", (req, res) => {
  res.json({
    name: "Desktop Commander MCP Proxy",
    version: "1.0.0",
    status: "online",
    activeSessions: sessions.size,
    workspace: WORKSPACE_PATH,
  });
});

// Start server
app.listen(PORT, "0.0.0.0", () => {
  logger.info(`MCP Proxy Server listening on port ${PORT}`);
  logger.info(`Workspace: ${WORKSPACE_PATH}`);
  logger.info(`Endpoint: http://localhost:${PORT}/mcp`);
  logger.info(`Health: http://localhost:${PORT}/health`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  logger.info("Shutting down...");
  for (const [sessionId, session] of sessions) {
    session.process.kill();
  }
  process.exit(0);
});

process.on("SIGINT", () => {
  logger.info("Shutting down...");
  for (const [sessionId, session] of sessions) {
    session.process.kill();
  }
  process.exit(0);
});
