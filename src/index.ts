import "dotenv/config";
import express from "express";
import cors from "cors";
import { randomUUID } from "crypto";
import { MCPServer } from "@mastra/mcp";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { StdioBridge } from "./bridge.js";

const app = express();
app.use(cors());
app.use(express.json());

// Initialize desktop-commander bridge
const desktopCommanderBridge = new StdioBridge({
  command: "npx",
  args: ["-y", "@wonderwhy-er/desktop-commander@latest"],
  env: {
    ALLOWED_DIRECTORIES: process.env.ALLOWED_DIRECTORIES || "/data", // Default to /data if not set
    BLOCKED_COMMANDS: process.env.DESKTOP_BLOCKED_COMMANDS || "rm -rf /,dd,mkfs,sudo,su",
    // Pass through other relevant env vars if needed
    PATH: process.env.PATH || "", 
  },
  basePath: "/data",
  debug: process.env.DEBUG_PATHS === "true",
});

// Session store
const sessions = new Map<string, StreamableHTTPServerTransport>();

// Tool cache
let toolCache: Record<string, any> = {};

async function loadTools() {
  console.log("\n🔧 Loading Desktop Commander Tools...");
  try {
    const allTools = await desktopCommanderBridge.getMastraTools();
    toolCache = allTools;
    console.log(`    ✅ ${Object.keys(toolCache).length} tools loaded`);
  } catch (err) {
    console.error("❌ Failed to load tools:", err);
  }
}

// MCP Route
app.all("/mcp", async (req, res) => {
  try {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    let transport: StreamableHTTPServerTransport | undefined;

    console.log(
      `📡 [DesktopCommander] ${req.method} request from ${req.ip}${sessionId ? ` (session: ${sessionId})` : ""}`,
    );

    if (sessionId && sessions.has(sessionId)) {
      transport = sessions.get(sessionId);
    } else if (
      !sessionId &&
      req.method === "POST" &&
      req.body?.method === "initialize"
    ) {
      console.log(
        `🔧 [DesktopCommander] Creating MCPServer with ${Object.keys(toolCache).length} tools`,
      );

      const server = new MCPServer({
        id: `desktop-commander-${randomUUID()}`,
        name: "Desktop Commander MCP Server",
        version: "1.0.0",
        tools: toolCache,
      });

      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          console.log(`✅ [DesktopCommander] Session initialized: ${sid}`);
          sessions.set(sid, transport!);
        },
      });

      transport.onclose = () => {
        const sid = transport!.sessionId;
        if (sid && sessions.has(sid)) {
          console.log(`🔴 [DesktopCommander] Closed: ${sid}`);
          sessions.delete(sid);
        }
      };

      const sdkServer = server.getServer();
      await sdkServer.connect(transport);
    } else {
      console.error(`❌ [DesktopCommander] Invalid request - no valid session`);
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
    console.error(`❌ [DesktopCommander] Error:`, err);
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

console.log("🚀 Route created: /mcp");

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    name: "Desktop Commander MCP Server",
    version: "1.0.0",
    status: "online",
    tools: Object.keys(toolCache).length,
    activeSessions: sessions.size,
    url: "/mcp",
  });
});

// Root endpoint
app.get("/", (req, res) => {
  res.json({
    name: "Desktop Commander MCP Server",
    version: "1.0.0",
    status: "online",
    url: "/mcp",
  });
});

// Start server
const PORT = parseInt(process.env.PORT || "8081", 10);

async function start() {
  try {
    await loadTools();

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`\n🚀 Desktop Commander MCP Server ready on port ${PORT}`);
      console.log(`\n📍 Endpoint: http://localhost:${PORT}/mcp`);
      console.log(`\n💡 Health check: http://localhost:${PORT}/health\n`);
    });
  } catch (err) {
    console.error("❌ Failed to start server:", err);
    process.exit(1);
  }
}

start();
