import "dotenv/config";
import express from "express";
import cors from "cors";
import { randomUUID } from "crypto";
import { MCPServer } from "@mastra/mcp";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { backlogTools, backlogResources } from "./backlog_tools.js";
import { memoryTools } from "./memory_tools.js";
import { StdioBridge } from "./bridge.js";

const app = express();
app.use(cors());

// Segment enablement from ENV
const segments = {
  backlog: process.env.ENABLE_BACKLOG !== "false",
  memory: process.env.ENABLE_MEMORY !== "false",
  desktop: process.env.ENABLE_DESKTOP !== "false",
  context: process.env.ENABLE_CONTEXT !== "false",
  serena: process.env.ENABLE_SERENA !== "false",
  thinking: process.env.ENABLE_THINKING !== "false",
};

console.log("📊 Segment Configuration:");
Object.entries(segments).forEach(([name, enabled]) => {
  console.log(`  ${enabled ? "✅" : "❌"} ${name}`);
});

// Initialize bridges for external MCPs
const bridges = {
  desktop: segments.desktop ? new StdioBridge({
    command: "npx",
    args: ["-y", "@wonderwhy-er/desktop-commander@latest"],
    env: {
      ALLOWED_DIRECTORIES: "/data",
      BLOCKED_COMMANDS: "rm -rf /,dd,mkfs,sudo,su",
    },
    basePath: "/data",
    debug: process.env.DEBUG_PATHS === "true"
  }) : null,
  context: segments.context ? new StdioBridge({
    command: "npx",
    args: ["@zilliz/claude-context-mcp@latest"],
    basePath: "/data",
    debug: process.env.DEBUG_PATHS === "true"
  }) : null,
  serena: segments.serena ? new StdioBridge({
    command: "uvx",
    args: [
      "--from", "git+https://github.com/oraios/serena",
      "serena", "start-mcp-server",
      "--context", "ide",
      "--project-from-cwd",
      "--open-web-dashboard", "False"
    ],
    basePath: "/data",
    debug: process.env.DEBUG_PATHS === "true"
  }) : null,
  thinking: segments.thinking ? new StdioBridge({
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-sequential-thinking"],
    basePath: "/data",
    debug: process.env.DEBUG_PATHS === "true"
  }) : null,
};

// Session stores for each segment
const sessionStores: Record<string, Map<string, SSEServerTransport>> = {
  backlog: new Map(),
  memory: new Map(),
  desktop: new Map(),
  context: new Map(),
  serena: new Map(),
  thinking: new Map(),
};

// Tool caches for bridges
const toolCaches: Record<string, any> = {};

async function loadTools() {
  console.log("\n🔧 Loading Tools...");
  
  if (bridges.desktop) {
    console.log("  Loading Desktop Commander tools...");
    toolCaches.desktop = await bridges.desktop.getMastraTools();
    console.log(`    ✅ ${Object.keys(toolCaches.desktop).length} tools loaded`);
  }
  
  if (bridges.context) {
    console.log("  Loading Claude Context tools...");
    toolCaches.context = await bridges.context.getMastraTools();
    console.log(`    ✅ ${Object.keys(toolCaches.context).length} tools loaded`);
  }
  
  if (bridges.serena) {
    console.log("  Loading Serena tools...");
    toolCaches.serena = await bridges.serena.getMastraTools();
    console.log(`    ✅ ${Object.keys(toolCaches.serena).length} tools loaded`);
  }
  
  if (bridges.thinking) {
    console.log("  Loading Sequential Thinking tools...");
    toolCaches.thinking = await bridges.thinking.getMastraTools();
    console.log(`    ✅ ${Object.keys(toolCaches.thinking).length} tools loaded`);
  }
  
  console.log("\n✨ All tools loaded successfully!\n");
}

// Create segment route
function createSegmentRoute(
  segmentName: string,
  tools: Record<string, any>,
  resources?: any
) {
  const sessions = sessionStores[segmentName];

  // SSE endpoint
  app.get(`/${segmentName}/sse`, async (req, res) => {
    try {
      console.log(`📡 [${segmentName}] New connection from ${req.ip}`);
      
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');

      console.log(`🔧 [${segmentName}] Creating MCPServer with ${Object.keys(tools).length} tools`);
      
      // Log tool names for debugging
      Object.keys(tools).forEach(toolName => {
        console.log(`   - Tool: ${toolName}`);
      });
      
      const server = new MCPServer({
        id: `${segmentName}-${randomUUID()}`,
        name: `MCP ${segmentName.charAt(0).toUpperCase() + segmentName.slice(1)} Server`,
        version: "1.4.0",
        tools,
        resources,
      });

      const transport = new SSEServerTransport(`/${segmentName}/messages`, res);
      const sessionId = transport.sessionId;

      const sdkServer = server.getServer();
      await sdkServer.connect(transport);

      sessions.set(sessionId, transport);
      console.log(`✅ [${segmentName}] Session: ${sessionId}`);

      req.on("close", () => {
        console.log(`🔴 [${segmentName}] Closed: ${sessionId}`);
        sessions.delete(sessionId);
      });
    } catch (err: any) {
      console.error(`❌ [${segmentName}] Error:`, err);
      if (!res.headersSent) {
        res.status(500).json({ error: "SSE failed", details: err.message });
      }
    }
  });

  // Messages endpoint
  app.post(`/${segmentName}/messages`, async (req, res) => {
    const sessionId = req.query.sessionId as string;
    const transport = sessions.get(sessionId);
    
    if (!transport) {
      console.error(`❌ [${segmentName}] Session not found: ${sessionId}`);
      return res.status(404).json({ error: "Session not found" });
    }
    
    // Capture raw body for debugging
    const chunks: Buffer[] = [];
    const originalOnData = req.on.bind(req);
    
    req.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    
    req.on('end', () => {
      const rawBody = Buffer.concat(chunks).toString('utf8');
      console.log(`\n📨 [${segmentName}] RAW HTTP BODY:`);
      console.log(`═══════════════════════════════════════════════════════`);
      console.log(rawBody);
      try {
        const parsed = JSON.parse(rawBody);
        console.log(`\n📋 Parsed JSON:`);
        console.log(`  Method: ${parsed.method}`);
        console.log(`  Params: ${JSON.stringify(parsed.params, null, 2)}`);
      } catch (e) {
        console.log(`\n⚠️  Not valid JSON`);
      }
      console.log(`═══════════════════════════════════════════════════════\n`);
    });
    
    try {
      await transport.handlePostMessage(req, res);
      console.log(`✅ [${segmentName}] Message handled successfully`);
    } catch (err: any) {
      console.error(`❌ [${segmentName}] Message error:`, err);
      console.error(`   Error details:`, err.message);
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to handle message", details: err.message });
      }
    }
  });

  console.log(`🚀 Route created: /${segmentName}/sse`);
}

// Health check endpoint
app.get("/health", (req, res) => {
  const status: Record<string, any> = {
    name: "Mastra Segmented MCP Hub",
    version: "1.4.0",
    status: "online",
    segments: {},
  };

  Object.entries(segments).forEach(([name, enabled]) => {
    if (enabled) {
      status.segments[name] = {
        enabled: true,
        activeSessions: sessionStores[name].size,
        tools: name === "backlog" ? Object.keys(backlogTools).length :
               name === "memory" ? Object.keys(memoryTools).length :
               toolCaches[name] ? Object.keys(toolCaches[name]).length : 0,
        url: `/${name}/sse`,
      };
    } else {
      status.segments[name] = { enabled: false };
    }
  });

  res.json(status);
});

// Root endpoint
app.get("/", (req, res) => {
  res.json({
    name: "Mastra Segmented MCP Hub",
    version: "1.4.0",
    status: "online",
    segments: Object.entries(segments)
      .filter(([_, enabled]) => enabled)
      .map(([name]) => ({
        name,
        url: `/${name}/sse`,
      })),
  });
});

// Initialize all segments
async function initializeSegments() {
  console.log("\n🎯 Initializing Segments...\n");

  if (segments.backlog) {
    createSegmentRoute("backlog", backlogTools, backlogResources);
  }

  if (segments.memory) {
    createSegmentRoute("memory", memoryTools);
  }

  if (segments.desktop && toolCaches.desktop) {
    createSegmentRoute("desktop", toolCaches.desktop);
  }

  if (segments.context && toolCaches.context) {
    createSegmentRoute("context", toolCaches.context);
  }

  if (segments.serena && toolCaches.serena) {
    createSegmentRoute("serena", toolCaches.serena);
  }

  if (segments.thinking && toolCaches.thinking) {
    createSegmentRoute("thinking", toolCaches.thinking);
  }
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
      Object.entries(segments)
        .filter(([_, enabled]) => enabled)
        .forEach(([name]) => {
          console.log(`   http://localhost:${PORT}/${name}/sse`);
        });
      console.log(`\n💡 Health check: http://localhost:${PORT}/health\n`);
    });
  } catch (err) {
    console.error("❌ Failed to start server:", err);
    process.exit(1);
  }
}

start();
