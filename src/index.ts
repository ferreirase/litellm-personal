import "dotenv/config";
import express from "express";
import cors from "cors";
import { randomUUID } from "crypto";
import { MCPServer } from "@mastra/mcp";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { memoryTools } from "./memory_tools.js";
import { StdioBridge } from "./bridge.js";
import { readFileSync } from "fs";
import { join } from "path";

const app = express();
app.use(cors());
app.use(express.json());

// Read mcps.json configuration
const mcpConfig = JSON.parse(
  readFileSync(join(process.cwd(), "mcps.json"), "utf-8"),
);

// Filter out serena and disabled servers from config
const filteredMcpServers: Record<string, { command: string; args: string[]; disabled?: boolean }> =
  {};
Object.entries(mcpConfig.mcpServers).forEach(
  ([name, config]: [string, any]) => {
    if (name !== "serena" && !config.disabled) {
      filteredMcpServers[name] = config;
    }
  },
);

console.log("📊 MCP Servers from mcps.json (excluding serena & disabled):");
Object.keys(filteredMcpServers).forEach((name) => {
  console.log(`  ✅ ${name}`);
});

// Segment enablement from ENV (for native modules only)
const nativeSegments = {
  memory: process.env.ENABLE_MEMORY !== "false",
};

// Initialize bridges dynamically from mcps.json
const bridges: Record<string, StdioBridge | null> = {};

Object.entries(filteredMcpServers).forEach(([name, config]: [string, any]) => {
  const envVar = `ENABLE_${name.toUpperCase()}`;
  if (process.env[envVar] !== "false") {
    let env = config.env || {};

    if (name === "desktop-commander" && process.env.DESKTOP_BLOCKED_COMMANDS) {
      env = {
        ...env,
        BLOCKED_COMMANDS: process.env.DESKTOP_BLOCKED_COMMANDS,
      };
    }

    bridges[name] = new StdioBridge({
      command: config.command,
      args: config.args,
      env,
      basePath: "/data",
      debug: process.env.DEBUG_PATHS === "true",
    });
  } else {
    bridges[name] = null;
  }
});

// Session stores for each segment
const sessionStores: Record<
  string,
  Map<string, StreamableHTTPServerTransport>
> = {};

// Initialize session stores for native segments
Object.keys(nativeSegments).forEach((name) => {
  sessionStores[name] = new Map();
});

// Initialize session stores for MCP servers
Object.keys(filteredMcpServers).forEach((name) => {
  sessionStores[name] = new Map();
});

// Tool caches for bridges
const toolCaches: Record<string, any> = {};

// Segment servers - one MCPServer instance per segment (shared across sessions)
const segmentServers: Record<string, MCPServer> = {};

async function loadTools() {
  console.log("\n🔧 Loading Tools...");

  // Load tools from MCP servers
  for (const [name, bridge] of Object.entries(bridges)) {
    if (bridge) {
      console.log(`  Loading ${name} tools...`);
      toolCaches[name] = await bridge.getMastraTools();
      console.log(
        `    ✅ ${Object.keys(toolCaches[name]).length} tools loaded`,
      );
    }
  }

  console.log("\n✨ All tools loaded successfully!\n");
}

// Create segment route
function createSegmentRoute(
  segmentName: string,
  server: MCPServer,
) {
  const sessions = sessionStores[segmentName];
  const sdkServer = server.getServer();

  // Streamable HTTP endpoint (handles GET, POST, DELETE)
  app.all(`/${segmentName}/mcp`, async (req, res) => {
    try {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      let transport: StreamableHTTPServerTransport | undefined;

      console.log(
        `📡 [${segmentName}] ${req.method} request from ${req.ip}${sessionId ? ` (session: ${sessionId})` : ""}`,
      );

      if (sessionId && sessions.has(sessionId)) {
        transport = sessions.get(sessionId);
      } else if (
        !sessionId &&
        req.method === "POST" &&
        req.body?.method === "initialize"
      ) {
        console.log(
          `🔧 [${segmentName}] Creating new transport for session (reusing shared server)`,
        );

        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid) => {
            console.log(`✅ [${segmentName}] Session initialized: ${sid}`);
            sessions.set(sid, transport!);
          },
        });

        transport.onclose = () => {
          const sid = transport!.sessionId;
          if (sid && sessions.has(sid)) {
            console.log(`🔴 [${segmentName}] Closed: ${sid}`);
            sessions.delete(sid);
          }
        };

        // Connect the transport to the shared server
        await sdkServer.connect(transport);
      } else {
        console.error(`❌ [${segmentName}] Invalid request - no valid session`);
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
      console.error(`❌ [${segmentName}] Error:`, err);
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

  console.log(`🚀 Route created: /${segmentName}/mcp`);
}

// Health check endpoint
app.get("/health", (req, res) => {
  const status: Record<string, any> = {
    name: "Mastra Segmented MCP Hub",
    version: "1.4.0",
    status: "online",
    segments: {},
  };

  // Native segments
  Object.entries(nativeSegments).forEach(([name, enabled]) => {
    if (enabled) {
      status.segments[name] = {
        enabled: true,
        activeSessions: sessionStores[name].size,
        tools: name === "memory" ? Object.keys(memoryTools).length : 0,
        url: `/${name}/mcp`,
      };
    } else {
      status.segments[name] = { enabled: false };
    }
  });

  // MCP server segments
  Object.entries(filteredMcpServers).forEach(([name, config]) => {
    const enabled = bridges[name] !== null;
    status.segments[name] = {
      enabled,
      activeSessions: enabled ? sessionStores[name].size : 0,
      tools:
        enabled && toolCaches[name] ? Object.keys(toolCaches[name]).length : 0,
      url: enabled ? `/${name}/mcp` : null,
    };
  });

  res.json(status);
});

// Root endpoint
app.get("/", (req, res) => {
  const enabledSegments: string[] = [];

  Object.entries(nativeSegments).forEach(([name, enabled]) => {
    if (enabled) enabledSegments.push(name);
  });

  Object.entries(filteredMcpServers).forEach(([name]) => {
    if (bridges[name] !== null) enabledSegments.push(name);
  });

  res.json({
    name: "Mastra Segmented MCP Hub",
    version: "1.4.0",
    status: "online",
    segments: enabledSegments.map((name) => ({
      name,
      url: `/${name}/mcp`,
    })),
  });
});

// Initialize all segments
async function initializeSegments() {
  console.log("\n🎯 Initializing Segments...\n");

  // Initialize native segments
  if (nativeSegments.memory) {
    console.log(`📦 [memory] Creating shared MCPServer with ${Object.keys(memoryTools).length} tools`);
    segmentServers.memory = new MCPServer({
      id: "memory-server",
      name: "MCP Memory Server",
      version: "1.4.0",
      tools: memoryTools,
    });
    createSegmentRoute("memory", segmentServers.memory);
  }

  // Initialize MCP server segments
  Object.entries(filteredMcpServers).forEach(([name, config]) => {
    if (bridges[name] && toolCaches[name]) {
      console.log(`📦 [${name}] Creating shared MCPServer with ${Object.keys(toolCaches[name]).length} tools`);
      segmentServers[name] = new MCPServer({
        id: `${name}-server`,
        name: `MCP ${name.charAt(0).toUpperCase() + name.slice(1)} Server`,
        version: "1.4.0",
        tools: toolCaches[name],
      });
      createSegmentRoute(name, segmentServers[name]);
    }
  });
}

// Start server
const PORT = parseInt(process.env.PORT || "8081", 10);

async function start() {
  try {
    await loadTools();
    await initializeSegments();

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`\n🚀 Segmented MCP Hub ready on port ${PORT}`);
      console.log(`\n📍 Available endpoints:`);

      Object.entries(nativeSegments).forEach(([name, enabled]) => {
        if (enabled) {
          console.log(`   http://localhost:${PORT}/${name}/mcp`);
        }
      });

      Object.entries(filteredMcpServers).forEach(([name]) => {
        if (bridges[name] !== null) {
          console.log(`   http://localhost:${PORT}/${name}/mcp`);
        }
      });

      console.log(`\n💡 Health check: http://localhost:${PORT}/health\n`);
    });
  } catch (err) {
    console.error("❌ Failed to start server:", err);
    process.exit(1);
  }
}

start();
