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

// Read .mcp.json configuration
const mcpConfig = JSON.parse(
  readFileSync(join(process.cwd(), ".mcp.json"), "utf-8"),
);

// Filter out serena from config
const filteredMcpServers: Record<string, { command: string; args: string[] }> =
  {};
Object.entries(mcpConfig.mcpServers).forEach(
  ([name, config]: [string, any]) => {
    if (name !== "serena") {
      filteredMcpServers[name] = config;
    }
  },
);

console.log("📊 MCP Servers from .mcp.json (excluding serena):");
Object.keys(filteredMcpServers).forEach((name) => {
  console.log(`  ✅ ${name}`);
});

// Segment enablement from ENV (for native modules only)
const nativeSegments = {
  memory: process.env.ENABLE_MEMORY !== "false",
};

// Initialize bridges dynamically from .mcp.json
const bridges: Record<string, StdioBridge | null> = {};

Object.entries(filteredMcpServers).forEach(([name, config]: [string, any]) => {
  const envVar = `ENABLE_${name.toUpperCase()}`;
  if (process.env[envVar] !== "false") {
    bridges[name] = new StdioBridge({
      command: config.command,
      args: config.args,
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
  tools: Record<string, any>,
  resources?: any,
) {
  const sessions = sessionStores[segmentName];

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
          `🔧 [${segmentName}] Creating MCPServer with ${Object.keys(tools).length} tools`,
        );

        const server = new MCPServer({
          id: `${segmentName}-${randomUUID()}`,
          name: `MCP ${segmentName.charAt(0).toUpperCase() + segmentName.slice(1)} Server`,
          version: "1.4.0",
          tools,
          resources,
        });

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

        const sdkServer = server.getServer();
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
    createSegmentRoute("memory", memoryTools);
  }

  // Initialize MCP server segments
  Object.entries(filteredMcpServers).forEach(([name, config]) => {
    if (bridges[name] && toolCaches[name]) {
      createSegmentRoute(name, toolCaches[name]);
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
