import "dotenv/config";
import express from "express";
import cors from "cors";
import { spawn, ChildProcess } from "child_process";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ConsoleLogger } from "./logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = parseInt(process.env.PORT || "8085", 10);
const WORKSPACE_PATH = process.env.WORKSPACE_PATH || "/workspace";
const LOG_LEVEL = (process.env.LOG_LEVEL as any) || "info";
const PATH_REWRITE_FROM = process.env.PATH_REWRITE_FROM || "";
const PATH_REWRITE_TO = process.env.PATH_REWRITE_TO || "";

function rewritePath(inputPath: string): string {
  if (PATH_REWRITE_FROM && inputPath.startsWith(PATH_REWRITE_FROM)) {
    return PATH_REWRITE_TO + inputPath.slice(PATH_REWRITE_FROM.length);
  }
  return inputPath;
}

const logger = new ConsoleLogger(LOG_LEVEL);
const app = express();

// CORS configuration
app.use(
  cors({
    origin: "*",
    exposedHeaders: ["Mcp-Session-Id"],
  }),
);
app.use(express.json({ limit: "10mb" }));

// --- MCP Server Registry ---

interface McpServerConfig {
  command: string;
  args: string[];
  extraEnv?: Record<string, string>;
  cwd?: string;
  allowCwdOverride?: boolean;
}

const MCP_SERVERS: Record<string, McpServerConfig> = {
  "sequential-thinking": {
    command: process.execPath,
    args: [
      "--no-warnings",
      path.resolve(
        __dirname,
        "..",
        "node_modules",
        "@modelcontextprotocol",
        "server-sequential-thinking",
        "dist",
        "index.js",
      ),
    ],
  },
  "claude-context": {
    command: "node",
    args: [
      "/home/ferreirase/Documents/Estudos/AI/claude-context/packages/mcp/dist/index.js",
    ],
    extraEnv: {
      // Usar Milvus como vector database (zvec requer AVX-512, CPU nao suporta)
      VECTOR_DB_PROVIDER: "milvus",
      MILVUS_ADDRESS: process.env.MILVUS_ADDRESS || "milvus-standalone:19530",

      // Seu provider de embedding (VoyageAI)
      VOYAGEAI_API_KEY: process.env.VOYAGEAI_API_KEY || "",
      EMBEDDING_PROVIDER: process.env.EMBEDDING_PROVIDER || "VoyageAI",
      EMBEDDING_MODEL: process.env.EMBEDDING_MODEL || "voyage-code-3",
    },
  },
  "mastra-memory": {
    command: process.env.NODE_BINARY || "node",
    args: ["/home/ferreirase/Documents/Estudos/AI/ai-memory/dist/index.js"],
    cwd: "/home/ferreirase/Documents/Estudos/AI/ai-memory",
    extraEnv: {
      DATABASE_URL: process.env.MASTRA_DATABASE_URL || "",
      OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || "",
    },
  },
  serena: {
    command: "/home/ferreirase/.local/bin/uvx",
    args: [
      "--from",
      "git+https://github.com/oraios/serena",
      "serena",
      "start-mcp-server",
      "--context",
      "/home/ferreirase/Documents/Estudos/AI/mcp-to-server/serena-full-context.yml",
      "--mode",
      "interactive",
      "--project-from-cwd",
    ],
    cwd: WORKSPACE_PATH,
    allowCwdOverride: true,
  },
};

// Validate that absolute-path commands exist on the filesystem at startup
for (const [name, config] of Object.entries(MCP_SERVERS)) {
  const cmd = config.command;
  if (cmd.startsWith("/")) {
    if (!fs.existsSync(cmd)) {
      logger.warn(`[${name}] command not found: ${cmd}`);
    } else {
      logger.info(`[${name}] command OK: ${cmd}`);
    }
  }
}

// --- Session Management ---

interface Session {
  id: string;
  serverName: string;
  process: ChildProcess;
  buffer: string;
  pendingRequests: Map<
    string | number,
    { resolve: Function; reject: Function }
  >;
  cwd: string;
  lastActivity: number;
}

// Key: "${serverName}:${sessionId}"
const sessions = new Map<string, Session>();

// Semáforo: no máximo N subprocessos inicializando ao mesmo tempo
const INIT_CONCURRENCY = parseInt(process.env.INIT_CONCURRENCY || "3");
let activeInits = 0;
const initQueue: Array<() => void> = [];

function acquireInitSlot(): Promise<void> {
  return new Promise((resolve) => {
    if (activeInits < INIT_CONCURRENCY) {
      activeInits++;
      resolve();
    } else {
      initQueue.push(() => { activeInits++; resolve(); });
    }
  });
}

function releaseInitSlot(): void {
  const next = initQueue.shift();
  if (next) {
    next();
  } else {
    activeInits--;
  }
}

const SESSION_IDLE_TIMEOUT_MS = parseInt(
  process.env.SESSION_IDLE_TIMEOUT_MS || "1800000",
); // 30 min default
const SESSION_MAX_PER_SERVER = parseInt(
  process.env.SESSION_MAX_PER_SERVER || "10",
);

setInterval(() => {
  const now = Date.now();
  for (const [key, session] of sessions) {
    if (now - session.lastActivity > SESSION_IDLE_TIMEOUT_MS) {
      logger.info(`[${key}] idle timeout — killing subprocess`);
      session.process.kill("SIGTERM");
      sessions.delete(key);
    }
  }
}, 60_000);

function sessionKey(serverName: string, sessionId: string): string {
  return `${serverName}:${sessionId}`;
}

/**
 * Create a new MCP subprocess for a session
 */
function createMcpProcess(
  serverName: string,
  sessionId: string,
  config: McpServerConfig,
  effectiveCwd?: string,
): Session {
  let resolvedCwd = effectiveCwd || config.cwd || WORKSPACE_PATH;
  // Fall back to /app if the resolved cwd doesn't exist (e.g. WORKSPACE_PATH
  // points to a host path that isn't mounted yet).
  if (!fs.existsSync(resolvedCwd)) {
    logger.warn(`[${serverName}] cwd not found: ${resolvedCwd}, falling back to /app`);
    resolvedCwd = "/app";
  }
  const env = { ...process.env, ...(config.extraEnv || {}) };

  logger.info(
    `Creating ${serverName} process for session ${sessionId}`,
  );
  logger.info(`  command: ${config.command}`);
  logger.info(`  args: ${JSON.stringify(config.args)}`);
  logger.info(`  cwd: ${resolvedCwd}`);
  logger.info(`  uid: ${process.getuid?.()}, gid: ${process.getgid?.()}`);

  const proc = spawn(config.command, config.args, {
    stdio: ["pipe", "pipe", "pipe"],
    env,
    cwd: resolvedCwd,
    uid: process.getuid?.(),
    gid: process.getgid?.(),
  });

  const session: Session = {
    id: sessionId,
    serverName,
    process: proc,
    buffer: "",
    pendingRequests: new Map(),
    cwd: resolvedCwd,
    lastActivity: Date.now(),
  };

  // Handle stdout - parse newline-delimited JSON-RPC
  proc.stdout?.on("data", (data: Buffer) => {
    const incoming = data.toString();
    const combined = session.buffer + incoming;
    const lines = combined.split("\n");
    session.buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const message = JSON.parse(line);
        logger.debug(`[${serverName}:${sessionId}] received:`, message);

        if (
          message.id !== undefined &&
          session.pendingRequests.has(message.id)
        ) {
          const { resolve } = session.pendingRequests.get(message.id)!;
          session.pendingRequests.delete(message.id);
          resolve(message);
        }
      } catch (error) {
        logger.error(
          `[${serverName}:${sessionId}] failed to parse:`,
          line,
          error,
        );
      }
    }
  });

  proc.stderr?.on("data", (data: Buffer) => {
    logger.debug(`[${serverName}:${sessionId}] stderr:`, data.toString());
  });

  proc.on("error", (error: Error) => {
    logger.error(`[${serverName}:${sessionId}] process error:`, error);
    sessions.delete(sessionKey(serverName, sessionId));
    // Rejeitar imediatamente todas as requisições em voo
    for (const [, { reject }] of session.pendingRequests) {
      reject(new Error(`[${serverName}:${sessionId}] subprocess error: ${error.message || (error as any).code || String(error)}`));
    }
    session.pendingRequests.clear();
  });

  proc.on("exit", (code: number | null, signal: string | null) => {
    logger.info(`[${serverName}:${sessionId}] process exited`, {
      code,
      signal,
    });
    sessions.delete(sessionKey(serverName, sessionId));
    // Rejeitar imediatamente todas as requisições em voo
    for (const [, { reject }] of session.pendingRequests) {
      reject(new Error(`subprocess exited (code=${code}, signal=${signal})`));
    }
    session.pendingRequests.clear();
  });

  return session;
}

/**
 * Send a JSON-RPC message to the subprocess.
 * - If message has id: waits for matching response (or times out)
 * - If no id (notification): resolves immediately after write
 */
async function sendToMcp(
  session: Session,
  message: any,
  timeoutMs = 30000,
): Promise<any> {
  return new Promise((resolve, reject) => {
    session.lastActivity = Date.now();
    const messageStr = JSON.stringify(message) + "\n";
    logger.debug(`[${session.serverName}:${session.id}] sending:`, message);

    session.process.stdin?.write(messageStr, (error) => {
      if (error) {
        logger.error(
          `[${session.serverName}:${session.id}] write error:`,
          error,
        );
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
  await acquireInitSlot();
  try {
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

  logger.info(
    `[${session.serverName}:${session.id}] initialized:`,
    initResponse?.result?.serverInfo,
  );

  // Notification — no id, no response
  await sendToMcp(session, {
    jsonrpc: "2.0",
    method: "notifications/initialized",
    params: {},
  });

  logger.info(`[${session.serverName}:${session.id}] ready`);
  } finally {
    releaseInitSlot();
  }
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

  // --- Resolve effective cwd ---
  let resolvedCwd = config.cwd || WORKSPACE_PATH;

  if (config.allowCwdOverride) {
    const rawRequestedPath =
      (req.headers["x-project-path"] as string) || (req.query.path as string);
    const requestedPath = rawRequestedPath ? rewritePath(rawRequestedPath) : undefined;
    if (requestedPath) {
      if (
        !requestedPath.startsWith(WORKSPACE_PATH) ||
        !fs.existsSync(requestedPath)
      ) {
        res.status(400).json({ error: `invalid path: ${requestedPath}` });
        return;
      }
      resolvedCwd = requestedPath;
    }
  }

  let sessionId = req.headers["mcp-session-id"] as string;
  if (!sessionId) {
    // Cliente sem session ID (ex: LiteLLM): reutilizar sessão existente se houver
    const existing = [...sessions.values()]
      .filter((s) => s.serverName === serverName)
      .filter((s) => !config.allowCwdOverride || s.cwd === resolvedCwd)
      .sort((a, b) => b.lastActivity - a.lastActivity)[0];
    sessionId = existing?.id ?? randomUUID();
  }
  const key = sessionKey(serverName, sessionId);
  let session = sessions.get(key);

  // Create + initialize new session if needed
  if (!session) {
    const serverSessions = [...sessions.values()].filter(
      (s) => s.serverName === serverName,
    );
    if (serverSessions.length >= SESSION_MAX_PER_SERVER) {
      const oldest = serverSessions.reduce((a, b) =>
        a.lastActivity < b.lastActivity ? a : b,
      );
      const oldestKey = sessionKey(oldest.serverName, oldest.id);
      logger.info(
        `[${oldestKey}] LRU eviction — cap reached for ${serverName}`,
      );
      oldest.process.kill("SIGTERM");
      sessions.delete(oldestKey);
    }

    session = createMcpProcess(serverName, sessionId, config, resolvedCwd);
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
  } else if (config.allowCwdOverride && resolvedCwd !== session.cwd) {
    logger.warn(
      `[${serverName}:${sessionId}] ignoring X-Project-Path override — session already bound to ${session.cwd}`,
    );
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

  // --- Generic set_project for servers with allowCwdOverride ---
  if (config.allowCwdOverride && body.method === "tools/call" && body.params?.name === "set_project") {
    const projectPath = rewritePath(body.params.arguments?.path || "");

    if (!projectPath || !projectPath.startsWith(WORKSPACE_PATH) || !fs.existsSync(projectPath)) {
      res.json({
        jsonrpc: "2.0",
        result: { content: [{ type: "text", text: `Error: invalid path: ${projectPath}` }] },
        id: body.id,
      });
      return;
    }

    // Already in the correct directory — no restart needed
    if (session && session.cwd === projectPath) {
      res.json({
        jsonrpc: "2.0",
        result: { content: [{ type: "text", text: `Already in ${projectPath}` }] },
        id: body.id,
      });
      return;
    }

    // Kill current session and restart in new directory
    const current = sessions.get(key);
    if (current) {
      current.process.kill();
      sessions.delete(key);
    }

    const newSession = createMcpProcess(serverName, sessionId, config, projectPath);
    sessions.set(key, newSession);

    try {
      await initializeSession(newSession);
      // Fetch tools from the new session so the client knows what's available
      let toolNames: string[] = [];
      try {
        const toolsResponse = await sendToMcp(newSession, {
          jsonrpc: "2.0",
          method: "tools/list",
          id: `set_project_tools_${Date.now()}`,
        });
        toolNames = (toolsResponse?.result?.tools || []).map((t: { name: string }) => t.name);
      } catch { /* ignore — tools discovery is best-effort */ }
      const toolsInfo = toolNames.length > 0
        ? `\nAvailable tools (${toolNames.length}): ${toolNames.join(", ")}`
        : "";
      res.json({
        jsonrpc: "2.0",
        result: { content: [{ type: "text", text: `Session switched to ${projectPath}${toolsInfo}` }] },
        id: body.id,
      });
    } catch (err: any) {
      res.json({
        jsonrpc: "2.0",
        result: { content: [{ type: "text", text: `Error: ${err.message}` }] },
        id: body.id,
      });
    }
    return;
  }

  // --- Serena-specific interceptions ---

  if (serverName === "serena") {
    if (body.method === "tools/list") {
      try {
        const response = await sendToMcp(session, body);
        if (response?.result?.tools) {
          response.result.tools = response.result.tools.filter(
            (tool: { name: string }) => !tool.name.startsWith("jet_brains_"),
          );
        }
        // Inject set_project for servers with allowCwdOverride
        if (config.allowCwdOverride && response?.result) {
          const setProjectTool = {
            name: "set_project",
            description:
              "Switch this MCP session to a different project directory. " +
              "The session restarts in the new directory. " +
              "Use this to set the project before using other tools.",
            inputSchema: {
              type: "object",
              properties: {
                path: { type: "string", description: "Absolute path to the project directory" },
              },
              required: ["path"],
            },
          };
          response.result.tools = [...(response.result.tools || []), setProjectTool];
        }
        res.json(response);
      } catch (error: any) {
        logger.error(`Request failed for session ${key}:`, error);
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: error.message || "Internal error" },
          id: body.id ?? null,
        });
      }
      return;
    }
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

// /mcp sem server path → listar servidores disponíveis
app.all("/mcp", (_req, res) => {
  res.status(400).json({
    error: "Server path required. Use /mcp/:server",
    available: Object.keys(MCP_SERVERS),
  });
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
  if (PATH_REWRITE_FROM) {
    logger.info(`Path rewrite: "${PATH_REWRITE_FROM}" → "${PATH_REWRITE_TO}"`);
  } else {
    logger.warn(`Path rewrite: DISABLED (PATH_REWRITE_FROM not set)`);
  }
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
