import "dotenv/config";
import express from "express";
import cors from "cors";
import { randomUUID } from "crypto";
import { MCPServer } from "@mastra/mcp";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  initProjectTool,
  listTasksTool,
  viewTaskTool,
  createTaskTool,
  editTaskTool,
  listDocsTool,
  viewDocTool,
} from "./tools.js";

const app = express();
app.use(cors());

// Global Map to store active sessions
const sessions = new Map<string, SSEServerTransport>();

// Tools definition
const backlogTools = {
  "init-project": initProjectTool,
  "list-tasks": listTasksTool,
  "view-task": viewTaskTool,
  "create-task": createTaskTool,
  "edit-task": editTaskTool,
  "list-docs": listDocsTool,
  "view-doc": viewDocTool,
};

app.get("/sse", async (req, res) => {
  try {
    console.log(`📡 [SSE] New connection from ${req.ip} (${req.get("user-agent")})`);
    
    // Disable buffering for Nginx/Proxies
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const server = new MCPServer({
      id: `backlog-${randomUUID()}`,
      name: "Backlog MCP Server",
      version: "1.3.2",
      tools: backlogTools,
    });

    // Use full URL for the endpoint to avoid resolution issues in some clients like LiteLLM
    const protocol = req.get("x-forwarded-proto") || req.protocol;
    const host = req.get("host");
    const endpoint = `${protocol}://${host}/sse`;
    
    console.log(`🔗 [SSE] Using endpoint: ${endpoint}`);

    const transport = new SSEServerTransport(endpoint as any, res);
    const sessionId = transport.sessionId;

    const sdkServer = server.getServer();
    await sdkServer.connect(transport);

    sessions.set(sessionId, transport);
    console.log(`✅ [SSE] Session created: ${sessionId}`);

    res.on("close", () => {
      console.log(`🔴 [SSE] Session closed: ${sessionId}`);
      sessions.delete(sessionId);
    });
  } catch (err: any) {
    console.error("❌ [SSE] Connection error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal Server Error", details: err.message });
    }
  }
});

// IMPORTANT: No express.json() here. 
// handlePostMessage reads the raw request stream.
app.post("/sse", async (req, res) => {
  const sessionId = req.query.sessionId as string;
  
  if (!sessionId) {
    console.warn("⚠️ [POST] Missing sessionId in query");
    return res.status(400).json({ error: "Missing sessionId" });
  }

  const transport = sessions.get(sessionId);

  if (!transport) {
    console.warn(`⚠️ [POST] Session not found: ${sessionId}`);
    return res.status(404).json({ error: "Session not found" });
  }

  try {
    await transport.handlePostMessage(req, res);
  } catch (err: any) {
    console.error(`❌ [POST] Error for session ${sessionId}:`, err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Message handling failed", details: err.message });
    }
  }
});

app.get("/", (req, res) => {
  res.json({ 
    name: "Backlog MCP Server", 
    status: "online", 
    sessions: sessions.size,
    version: "1.3.2"
  });
});

app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
});

const PORT = 8081;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Backlog MCP ready on port ${PORT}`);
});
