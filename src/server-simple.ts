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

// --- MCP Server Registry ---

interface McpServerConfig {
  command: string;
  args: string[];
  extraEnv?: Record<string, string>;
}

const MCP_SERVERS: Record<string, McpServerConfig> = {
  "desktop-commander": {
    command: "npx",
    args: ["@wonderwhy-er/desktop-commander@latest"],
    extraEnv: { WORKSPACE_PATH, LOG_LEVEL },
  },
  "sequential-thinking": {
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-sequential-thinking"],
  },
};

// --- Session Management ---

interface Session {
  id: string;
  serverName: string;
  process: ChildProcess;
  buffer: string;
  pendingRequests: Map<string | number, { resolve: Function; reject: Function }>;
}

// Key: "${serverName}:${sessionId}"
const sessions = new Map<string, Session>();

function sessionKey(serverName: string, sessionId: string): string {
  return `${serverName}:${sessionId}`;
}

/**
 * Create a new MCP subprocess for a session
 */
function createMcpProcess(serverName: string, sessionId: string, config: McpServerConfig): Session {
  logger.info(`Creating ${serverName} process for session ${sessionId}`);

  const env = { ...process.env, ...(config.extraEnv || {}) };

  const proc = spawn(config.command, config.args, {
    stdio: ["pipe", "pipe", "pipe"],
    env,
  });

  const session: Session = {
    id: sessionId,
    serverName,
    process: proc,
    buffer: "",
    pendingRequests: new Map(),
  };

  // Handle stdout - parse newline-delimited JSON-RPC
  proc.stdout?.on("data", (data: Buffer) => {
    session.buffer += data.toString();

    const lines = session.buffer.split("\n");
    session.buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const message = JSON.parse(line);
        logger.debug(`[${serverName}:${sessionId}] received:`, message);

        if (message.id !== undefined && session.pendingRequests.has(message.id)) {
          const { resolve } = session.pendingRequests.get(message.id)!;
          session.pendingRequests.delete(message.id);
          resolve(message);
        }
      } catch (error) {
        logger.error(`[${serverName}:${sessionId}] failed to parse:`, line, error);
      }
    }
  });

  proc.stderr?.on("data", (data: Buffer) => {
    logger.debug(`[${serverName}:${sessionId}] stderr:`, data.toString());
  });

  proc.on("error", (error: Error) => {
    logger.error(`[${serverName}:${sessionId}] process error:`, error);
  });

  proc.on("exit", (code: number | null, signal: string | null) => {
    logger.info(`[${serverName}:${sessionId}] process exited`, { code, signal });
    sessions.delete(sessionKey(serverName, sessionId));
  });

  return session;
}

/**
 * Send a JSON-RPC message to the subprocess.
 * - If message has id: waits for matching response (or times out)
 * - If no id (notification): resolves immediately after write
 */
async function sendToMcp(session: Session, message: any, timeoutMs = 30000): Promise<any> {
  return new Promise((resolve, reject) => {
    const messageStr = JSON.stringify(message) + "\n";
    logger.debug(`[${session.serverName}:${session.id}] sending:`, message);

    session.process.stdin?.write(messageStr, (error) => {
      if (error) {
        logger.error(`[${session.serverName}:${session.id}] write error:`, error);
        return reject(error);
      }
    });

    if (message.id !== undefined) {
      const timer = setTimeout(() => {
        if (session.pendingRequests.has(message.id)) {
          session.pendingRequests.delete(message.id);
          reject(new Error(`Request timeout (id=${message.id})`));
        }
      }, timeoutMs);

      session.pendingRequests.set(message.id, {
        resolve: (msg: any) => {
          clearTimeout(timer);
          resolve(msg);
        },
        reject: (err: any) => {
          clearTimeout(timer);
          reject(err);
        },
      });
    } else {
      // Notification — no response expected
      resolve(undefined);
    }
  });
}

/**
 * Perform the MCP initialization handshake for a new session.
 * initialize → initialized notification
 */
async function initializeSession(session: Session): Promise<void> {
  logger.info(`[${session.serverName}:${session.id}] initializing...`);

  // Give the process a moment to start
  await new Promise((resolve) => setTimeout(resolve, 1000));

  const initResponse = await sendToMcp(session, {
    jsonrpc: "2.0",
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      clientInfo: { name: "MCP HTTP Proxy", version: "1.0.0" },
    },
    id: 1,
  });

  logger.info(`[${session.serverName}:${session.id}] initialized:`, initResponse?.result?.serverInfo);

  // Notification — no id, no response
  await sendToMcp(session, {
    jsonrpc: "2.0",
    method: "notifications/initialized",
    params: {},
  });

  logger.info(`[${session.serverName}:${session.id}] ready`);
}

// --- Route handler ---

async function handleMcpRequest(
  serverName: string,
  req: express.Request,
  res: express.Response,
): Promise<void> {
  const config = MCP_SERVERS[serverName];

  if (!config) {
    res.status(404).json({
      jsonrpc: "2.0",
      error: {
        code: -32601,
        message: `Unknown MCP server: "${serverName}". Available: ${Object.keys(MCP_SERVERS).join(", ")}`,
      },
      id: null,
    });
    return;
  }

  const sessionId = (req.headers["mcp-session-id"] as string) || randomUUID();
  const key = sessionKey(serverName, sessionId);
  let session = sessions.get(key);

  // Create + initialize new session if needed
  if (!session) {
    session = createMcpProcess(serverName, sessionId, config);
    sessions.set(key, session);

    try {
      await initializeSession(session);
    } catch (error) {
      logger.error(`Failed to initialize session ${key}:`, error);
      sessions.delete(key);
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: `Failed to initialize ${serverName}`,
        },
        id: null,
      });
      return;
    }

    res.setHeader("Mcp-Session-Id", sessionId);
  }

  const body = req.body;

  if (!body || !body.jsonrpc) {
    res.status(400).json({
      jsonrpc: "2.0",
      error: { code: -32600, message: "Invalid JSON-RPC request" },
      id: null,
    });
    return;
  }

  try {
    const response = await sendToMcp(session, body);

    if (response) {
      res.json(response);
    } else {
      res.status(204).send();
    }
  } catch (error: any) {
    logger.error(`Request failed for session ${key}:`, error);
    res.status(500).json({
      jsonrpc: "2.0",
      error: {
        code: -32603,
        message: error.message || "Internal error",
      },
      id: body.id ?? null,
    });
  }
}

// --- Routes ---

// GET /mcp/servers — list available servers
app.get("/mcp/servers", (_req, res) => {
  res.json({ servers: Object.keys(MCP_SERVERS) });
});

// Backward-compat: /mcp → desktop-commander
app.all("/mcp", async (req, res) => {
  await handleMcpRequest("desktop-commander", req, res);
});

// /mcp/:server — route to any registered MCP server
app.all("/mcp/:server", async (req, res) => {
  await handleMcpRequest(req.params.server, req, res);
});

// Health check
app.get("/health", (_req, res) => {
  const sessionsByServer: Record<string, number> = {};
  for (const key of sessions.keys()) {
    const [serverName] = key.split(":");
    sessionsByServer[serverName] = (sessionsByServer[serverName] || 0) + 1;
  }

  res.json({
    name: "MCP HTTP Proxy",
    version: "2.0.0",
    status: "online",
    servers: Object.keys(MCP_SERVERS),
    activeSessions: sessions.size,
    sessionsByServer,
    workspace: WORKSPACE_PATH,
  });
});

// Start server
app.listen(PORT, "0.0.0.0", () => {
  logger.info(`MCP Proxy Server v2 listening on port ${PORT}`);
  logger.info(`Workspace: ${WORKSPACE_PATH}`);
  logger.info(`Available servers: ${Object.keys(MCP_SERVERS).join(", ")}`);
  logger.info(`Endpoints:`);
  for (const name of Object.keys(MCP_SERVERS)) {
    logger.info(`  http://localhost:${PORT}/mcp/${name}`);
  }
  logger.info(`Health: http://localhost:${PORT}/health`);
});

// Graceful shutdown
function shutdown() {
  logger.info("Shutting down, killing all subprocesses...");
  for (const session of sessions.values()) {
    session.process.kill();
  }
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
