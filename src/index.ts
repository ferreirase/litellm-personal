import "dotenv/config";
import express from "express";
import cors from "cors";
import { randomUUID } from "crypto";
import { loadConfig } from "./config.js";
import { createMcpClient } from "./bridge.js";
import { McpSession } from "./types.js";

const app = express();
app.use(express.json());
app.use(cors({ origin: true, credentials: true }));

const config = loadConfig();
const sessions = new Map<string, McpSession>();

const BASE_URL = process.env.BASE_URL || "http://localhost:8081";
const PORT = process.env.PORT || 8081;

// Root
app.get("/", (req, res) => {
  res.json({
    name: "MCP Gateway",
    version: "1.0.0",
    servers: Object.keys(config.servers),
    endpoints: {
      sse: `${BASE_URL}/sse`,
      health: `${BASE_URL}/health`,
    },
  });
});

// Health
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    sessions: sessions.size,
    servers: Object.keys(config.servers),
  });
});

// SSE Endpoint (all methods)
async function handleMcpRequest(req: express.Request, res: express.Response) {
  const serverName = req.headers["x-mcp-server"] as string;
  const sessionId = req.headers["mcp-session-id"] as string;

  if (!serverName) {
    return res.status(400).json({ error: "Missing X-MCP-Server header" });
  }

  if (!config.servers[serverName]) {
    return res.status(404).json({ error: `Server not found: ${serverName}` });
  }

  try {
    // Reuse existing session
    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId)!;

      // Proxy request to MCP client
      const method = req.body?.method || "ping";
      const params = req.body?.params || {};

      let result;
      if (method === "tools/list") {
        result = await session.client.listTools();
      } else if (method === "tools/call") {
        result = await session.client.callTool(params.name, params.arguments);
      } else if (method === "resources/list") {
        result = await session.client.listResources();
      } else if (method === "prompts/list") {
        result = await session.client.listPrompts();
      } else if (method === "ping") {
        result = await session.client.ping();
      } else {
        result = { error: "Unknown method" };
      }

      res.setHeader("Mcp-Session-Id", sessionId);
      return res.json({ jsonrpc: "2.0", result, id: req.body?.id || null });
    }

    // Create new session (initialize)
    if (req.body?.method === "initialize") {
      const newSessionId = randomUUID();
      const { client, transport } = await createMcpClient(
        serverName,
        config.servers[serverName],
      );

      sessions.set(newSessionId, {
        serverName,
        sessionId: newSessionId,
        client,
        transport,
        createdAt: Date.now(),
      });

      // Cleanup on transport close
      transport.onclose = () => {
        sessions.delete(newSessionId);
        console.log(`🔴 [${serverName}] Session closed: ${newSessionId}`);
      };

      res.setHeader("Mcp-Session-Id", newSessionId);
      return res.json({
        jsonrpc: "2.0",
        result: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          serverInfo: { name: serverName, version: "1.0.0" },
        },
        id: req.body?.id || null,
      });
    }

    res.status(400).json({ error: "Session ID required or send initialize" });
  } catch (error: any) {
    console.error(`❌ [${serverName}] Error:`, error.message);
    res.status(500).json({ error: error.message });
  }
}

app.post("/sse", handleMcpRequest);
app.get("/sse", handleMcpRequest);
app.delete("/sse", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string;
  const session = sessions.get(sessionId);

  if (session) {
    await session.transport.close();
    sessions.delete(sessionId);
  }

  res.json({ ok: true });
});

// Cleanup
process.on("SIGINT", async () => {
  console.log("\n🛑 Closing all sessions...");
  for (const session of sessions.values()) {
    await session.transport.close();
  }
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\n🛑 Closing all sessions...");
  for (const session of sessions.values()) {
    await session.transport.close();
  }
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`\n🚀 MCP Gateway running: ${BASE_URL}`);
  console.log(`📋 Servers: ${Object.keys(config.servers).join(", ")}\n`);
});
