
import "dotenv/config";
import express from "express";
import cors from "cors";
import { randomUUID } from "crypto";
import { MCPServer } from "@mastra/mcp";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { backlogTools } from "./backlog_tools.js";
import { memoryTools } from "./memory_tools.js";
import { StdioBridge } from "./bridge.js";

const app = express();
app.use(cors());

// Global Map to store active sessions
const sessions = new Map<string, SSEServerTransport>();

// Instantiate Bridges
const desktopCommander = new StdioBridge("npx", ["-y", "@wonderwhy-er/desktop-commander@latest"], {
  ALLOWED_DIRECTORIES: "/data",
  BLOCKED_COMMANDS: "rm -rf /,dd,mkfs,sudo,su",
});

const claudeContext = new StdioBridge("npx", ["@zilliz/claude-context-mcp@latest"]);

const thinking = new StdioBridge("npx", ["-y", "@modelcontextprotocol/server-sequential-thinking"]);

const serena = new StdioBridge("uvx", [
  "--from", "git+https://github.com/oraios/serena",
  "serena", "start-mcp-server",
  "--context", "ide",
  "--project-from-cwd",
  "--open-web-dashboard", "False"
]);

app.get("/sse", async (req, res) => {
  try {
    console.log(`📡 [SSE] Connection from ${req.ip}`);
    
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    // Load tools from all sources
    const dcTools = await desktopCommander.getMastraTools();
    const contextTools = await claudeContext.getMastraTools();
    const thinkTools = await thinking.getMastraTools();
    const serenaTools = await serena.getMastraTools();

    const allTools = {
      ...backlogTools,
      ...memoryTools,
      ...dcTools,
      ...contextTools,
      ...thinkTools,
      ...serenaTools,
    };

    const server = new MCPServer({
      id: `mcp-hub-${randomUUID()}`,
      name: "Mastra Unified MCP Hub",
      version: "1.4.0",
      tools: allTools,
      resources: {
        listResources: async () => [
          { uri: "backlog://workflow/overview", name: "Backlog Workflow Overview", mimeType: "text/markdown" },
          { uri: "backlog://workflow/task-creation", name: "Task Creation Guide", mimeType: "text/markdown" },
          { uri: "backlog://workflow/task-execution", name: "Task Execution Guide", mimeType: "text/markdown" },
          { uri: "backlog://workflow/task-completion", name: "Task Completion Guide", mimeType: "text/markdown" },
        ],
        getResourceContent: async ({ uri }) => {
          // Simplification: In a real scenario, this calls the CLI. 
          // For now, returning a placeholder or calling the CLI if available.
          return { text: `Content for ${uri}` };
        },
      }
    });

    const transport = new SSEServerTransport("/messages", res);
    const sessionId = transport.sessionId;

    const sdkServer = server.getServer();
    await sdkServer.connect(transport);

    sessions.set(sessionId, transport);
    console.log(`✅ [SSE] Session: ${sessionId}`);

    req.on("close", () => {
      console.log(`🔴 [SSE] Closed: ${sessionId}`);
      sessions.delete(sessionId);
    });
  } catch (err: any) {
    console.error("❌ [SSE] Error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "SSE failed", details: err.message });
    }
  }
});

app.post("/messages", async (req, res) => {
  const sessionId = req.query.sessionId as string;
  const transport = sessions.get(sessionId);
  if (!transport) return res.status(404).json({ error: "Session not found" });
  try {
    await transport.handlePostMessage(req, res);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to handle message" });
  }
});

app.get("/", (req, res) => {
  res.json({ name: "Unified Hub", status: "online", tools: "85 active" });
});

const PORT = 8081;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Unified MCP Hub ready on port ${PORT}`);
});
