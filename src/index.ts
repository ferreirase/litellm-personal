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
  console.log(`📡 [SSE] New connection: ${req.ip}`);

  const server = new MCPServer({
    id: `backlog-${randomUUID()}`,
    name: "Backlog MCP Server",
    version: "1.3.2",
    tools: backlogTools,
  });

  const transport = new SSEServerTransport("/sse", res);
  const sessionId = transport.sessionId;

  const sdkServer = (server as any).server;
  await sdkServer.connect(transport);

  sessions.set(sessionId, transport);
  console.log(`✅ [SSE] Session: ${sessionId}`);

  res.on("close", () => {
    console.log(`🔴 [SSE] Closed: ${sessionId}`);
    sessions.delete(sessionId);
  });
});

// IMPORTANT: No express.json() here. 
// handlePostMessage reads the raw request stream.
app.post("/sse", async (req, res) => {
  const sessionId = req.query.sessionId as string;
  const transport = sessions.get(sessionId);

  if (!transport) {
    return res.status(404).json({ error: "Session not found" });
  }

  try {
    await transport.handlePostMessage(req, res);
  } catch (err) {
    console.error(`❌ [POST] Error for ${sessionId}:`, err);
    res.status(500).end();
  }
});

app.get("/", (req, res) => {
  res.json({ name: "Backlog MCP", status: "online", active: sessions.size });
});

const PORT = 8081;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Backlog MCP ready on port ${PORT}`);
});
