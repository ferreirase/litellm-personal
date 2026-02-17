import "dotenv/config";
import express from "express";
import cors from "cors";
import { spawn, ChildProcess } from "child_process";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
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
  cwd?: string;
  allowCwdOverride?: boolean;
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
  "claude-context": {
    command: "npx",
    args: ["@zilliz/claude-context-mcp@latest"],
    extraEnv: {
      VOYAGEAI_API_KEY: process.env.VOYAGEAI_API_KEY || "",
      MILVUS_TOKEN: process.env.MILVUS_TOKEN || "",
      EMBEDDING_PROVIDER: process.env.EMBEDDING_PROVIDER || "VoyageAI",
      EMBEDDING_MODEL: process.env.EMBEDDING_MODEL || "voyage-code-3",
    },
  },
  "backlog": {
    command: "backlog",
    args: ["mcp", "start"],
    cwd: WORKSPACE_PATH,
    allowCwdOverride: true,
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
  "serena": {
    command: "/home/ferreirase/.local/bin/uvx",
    args: [
      "--from", "git+https://github.com/oraios/serena",
      "serena", "start-mcp-server",
      "--context", "claude-code",
      "--project-from-cwd",
    ],
    cwd: WORKSPACE_PATH,
    allowCwdOverride: true,
  },
};

const SERENA_DISABLED_TOOLS = new Set([
  "read_file",
  "list_dir",
  "create_text_file",
  "find_file",
  "search_for_pattern",
  "replace_regex",
  "execute_shell_command",
  "get_current_config",
  "initial_instructions",
  "prepare_for_new_conversation",
  "remove_project",
  "summarize_changes",
  "switch_modes",
  "think_about_collected_information",
  "think_about_task_adherence",
  "think_about_whether_you_are_done",
]);

// --- Session Management ---

interface Session {
  id: string;
  serverName: string;
  process: ChildProcess;
  buffer: string;
  pendingRequests: Map<string | number, { resolve: Function; reject: Function }>;
  cwd: string;
}

// Key: "${serverName}:${sessionId}"
const sessions = new Map<string, Session>();

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
  const resolvedCwd = effectiveCwd || config.cwd || WORKSPACE_PATH;
  logger.info(`Creating ${serverName} process for session ${sessionId} (cwd: ${resolvedCwd})`);

  const env = { ...process.env, ...(config.extraEnv || {}) };

  const proc = spawn(config.command, config.args, {
    stdio: ["pipe", "pipe", "pipe"],
    env,
    cwd: resolvedCwd,
  });

  const session: Session = {
    id: sessionId,
    serverName,
    process: proc,
    buffer: "",
    pendingRequests: new Map(),
    cwd: resolvedCwd,
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

/**
 * Run `backlog init --defaults [projectName]` in the given directory.
 * Sets GIT_CONFIG_* env vars to bypass git safe-directory ownership checks
 * that occur when the container user differs from the host file owner.
 */
function spawnInit(projectPath: string, projectName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "safe.directory",
      GIT_CONFIG_VALUE_0: "*",
    };
    const proc = spawn("backlog", ["init", "--defaults", projectName], {
      cwd: projectPath,
      stdio: "pipe",
      env,
    });
    proc.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`backlog init exited with code ${code}`)),
    );
    proc.on("error", reject);
  });
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
    const requestedPath =
      (req.headers["x-project-path"] as string) || (req.query.path as string);
    if (requestedPath) {
      if (!requestedPath.startsWith(WORKSPACE_PATH) || !fs.existsSync(requestedPath)) {
        res.status(400).json({ error: `invalid path: ${requestedPath}` });
        return;
      }
      resolvedCwd = requestedPath;
    }
  }

  const sessionId = (req.headers["mcp-session-id"] as string) || randomUUID();
  const key = sessionKey(serverName, sessionId);
  let session = sessions.get(key);

  // Create + initialize new session if needed
  if (!session) {
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

  // --- Backlog-specific interceptions ---

  if (serverName === "backlog") {
    // Inject synthetic backlog_init tool into tools/list response
    if (body.method === "tools/list") {
      try {
        const response = await sendToMcp(session, body);
        const initTool = {
          name: "backlog_init",
          description:
            "Initializes a backlog project in the specified directory. " +
            "Must be called before using other tools in projects without a backlog/ folder. " +
            "After init, all backlog tools become available automatically.",
          inputSchema: {
            type: "object",
            properties: {
              path: {
                type: "string",
                description: "Absolute path to the project directory",
              },
              name: {
                type: "string",
                description: "Project name (defaults to directory name)",
              },
            },
            required: ["path"],
          },
        };
        if (response?.result) {
          response.result.tools = [...(response.result.tools || []), initTool];
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

    // Intercept tools/call for backlog_init before forwarding to subprocess
    if (body.method === "tools/call" && body.params?.name === "backlog_init") {
      const { path: projectPath, name: projectName } = body.params.arguments || {};

      if (!projectPath || !projectPath.startsWith(WORKSPACE_PATH) || !fs.existsSync(projectPath)) {
        res.json({
          jsonrpc: "2.0",
          result: { content: [{ type: "text", text: `Error: invalid path: ${projectPath}` }] },
          id: body.id,
        });
        return;
      }

      const backlogDir = path.join(projectPath, "backlog");

      if (fs.existsSync(backlogDir)) {
        res.json({
          jsonrpc: "2.0",
          result: {
            content: [{ type: "text", text: `Project already initialized at ${projectPath}` }],
          },
          id: body.id,
        });
        return;
      }

      const name = projectName || path.basename(projectPath);

      try {
        await spawnInit(projectPath, name);
      } catch (err: any) {
        res.json({
          jsonrpc: "2.0",
          result: { content: [{ type: "text", text: `Init error: ${err.message}` }] },
          id: body.id,
        });
        return;
      }

      // Restart the subprocess so it picks up the new backlog/ folder
      session.process.kill();
      sessions.delete(key);

      const newSession = createMcpProcess(serverName, sessionId, config, session.cwd);
      sessions.set(key, newSession);

      try {
        await initializeSession(newSession);
      } catch (err: any) {
        logger.error(`Failed to re-initialize session after backlog_init:`, err);
      }

      res.json({
        jsonrpc: "2.0",
        result: {
          content: [
            {
              type: "text",
              text: `Project "${name}" initialized at ${projectPath}. Backlog tools are now available.`,
            },
          ],
        },
        id: body.id,
      });
      return;
    }
  }

  // --- Serena-specific interceptions ---

  if (serverName === "serena") {
    if (body.method === "tools/list") {
      try {
        const response = await sendToMcp(session, body);
        if (response?.result?.tools) {
          response.result.tools = response.result.tools.filter(
            (tool: { name: string }) => !SERENA_DISABLED_TOOLS.has(tool.name),
          );
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
