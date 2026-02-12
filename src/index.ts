import "dotenv/config";
import express from "express";
import cors from "cors";
import { readFileSync, existsSync, readdirSync } from "fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { randomUUID } from "crypto";
import { join, resolve, basename } from "path";
import { z } from "zod";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

const app = express();
app.use(express.json());
app.use(cors({
  origin: true,
  credentials: true,
  allowedHeaders: "*",
  exposedHeaders: ["Mcp-Session-Id"],
  methods: ["GET", "POST", "DELETE", "OPTIONS"]
}));

const HOST_ROOT = process.env.HOST_ROOT || "/home/ferreirase/Documents";
const CONTAINER_DATA = "/data";
const BASE_URL = process.env.BASE_URL || "http://localhost:8081";

function resolvePath(inputPath: string): string {
  if (inputPath.startsWith(HOST_ROOT)) {
    return inputPath.replace(HOST_ROOT, CONTAINER_DATA);
  }
  return inputPath;
}

function createMcpServer(projectPath: string) {
  const server = new McpServer({
    name: "backlog-mcp-server",
    version: "1.0.0"
  });

  const cwd = resolvePath(projectPath);

  const checkInit = () => {
    if (!existsSync(join(cwd, 'backlog'))) {
      throw new Error("No Backlog.md project found in this path. Please run 'init-project' tool first.");
    }
  };

  const escapeCmd = (val: string) => `"${val.replace(/"/g, '\\"')}"`;

  // Tool: Init Project
  server.registerTool(
    "init-project",
    { inputSchema: { projectName: z.string().optional().describe("The name of the project") } },
    async (args) => {
      const { projectName } = args as any;
      try {
        const name = projectName || basename(cwd);
        console.log(`🚀 [init-project] Initializing ${name} at: ${cwd}`);
        const { stdout } = await execAsync(`backlog init ${escapeCmd(name)} --defaults`, { cwd, timeout: 25000 });
        return { content: [{ type: "text", text: stdout || "Project initialized successfully" }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  // Tool: List Tasks
  server.registerTool(
    "list-tasks",
    {
      inputSchema: {
        status: z.string().optional().describe("Filter by status"),
        assignee: z.string().optional().describe("Filter by assignee"),
        priority: z.enum(["high", "medium", "low"]).optional().describe("Filter by priority")
      }
    },
    async (args) => {
      const { status, assignee, priority } = args as any;
      try {
        checkInit();
        let cmd = "backlog tasks list --plain";
        if (status) cmd += ` --status ${escapeCmd(status)}`;
        if (assignee) cmd += ` --assignee ${escapeCmd(assignee)}`;
        if (priority) cmd += ` --priority ${priority}`;
        const { stdout } = await execAsync(cmd, { cwd, timeout: 10000 });
        return { content: [{ type: "text", text: stdout || "No tasks found" }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  // Tool: View Task
  server.registerTool(
    "view-task",
    { inputSchema: { taskId: z.string().describe("Task ID") } },
    async (args) => {
      const { taskId } = args as any;
      try {
        checkInit();
        const { stdout } = await execAsync(`backlog tasks view ${taskId} --plain`, { cwd, timeout: 10000 });
        return { content: [{ type: "text", text: stdout || "Task not found" }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  // Tool: Create Task
  server.registerTool(
    "create-task",
    {
      inputSchema: {
        title: z.string().describe("Task title"),
        description: z.string().optional().describe("Detailed description"),
        status: z.string().optional().describe("Initial status"),
        priority: z.enum(["high", "medium", "low"]).optional().describe("Task priority"),
        assignees: z.array(z.string()).optional().describe("List of assignees"),
        labels: z.array(z.string()).optional().describe("List of labels"),
        plan: z.string().optional().describe("Implementation plan"),
        acceptance_criteria: z.array(z.string()).optional().describe("List of acceptance criteria"),
        notes: z.string().optional().describe("Additional notes"),
        dependencies: z.array(z.string()).optional().describe("List of task ID dependencies"),
        parent_id: z.string().optional().describe("Parent task ID"),
        is_draft: z.boolean().optional().describe("Initialize as a draft")
      }
    },
    async (args: any) => {
      try {
        checkInit();
        let cmd = `backlog tasks create ${escapeCmd(args.title)}`;
        if (args.description) cmd += ` --description ${escapeCmd(args.description)}`;
        if (args.status) cmd += ` --status ${escapeCmd(args.status)}`;
        if (args.priority) cmd += ` --priority ${args.priority}`;
        if (args.assignees) args.assignees.forEach((a: string) => cmd += ` -a ${escapeCmd(a)}`);
        if (args.labels) args.labels.forEach((l: string) => cmd += ` -l ${escapeCmd(l)}`);
        if (args.plan) cmd += ` --plan ${escapeCmd(args.plan)}`;
        if (args.acceptance_criteria) args.acceptance_criteria.forEach((ac: string) => cmd += ` --ac ${escapeCmd(ac)}`);
        if (args.notes) cmd += ` --notes ${escapeCmd(args.notes)}`;
        if (args.dependencies) args.dependencies.forEach((d: string) => cmd += ` --dep ${escapeCmd(d)}`);
        if (args.parent_id) cmd += ` --parent ${escapeCmd(args.parent_id)}`;
        if (args.is_draft) cmd += ` --draft`;
        
        const { stdout } = await execAsync(cmd, { cwd, timeout: 15000 });
        return { content: [{ type: "text", text: stdout || "Task created" }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  // Tool: Edit Task
  server.registerTool(
    "edit-task",
    {
      inputSchema: {
        taskId: z.string().describe("Task ID to edit"),
        title: z.string().optional().describe("New title"),
        description: z.string().optional().describe("New description"),
        status: z.string().optional().describe("New status"),
        priority: z.enum(["high", "medium", "low"]).optional().describe("New priority"),
        assignees: z.array(z.string()).optional().describe("New list of assignees"),
        labels: z.array(z.string()).optional().describe("New list of labels"),
        plan: z.string().optional().describe("New implementation plan"),
        acceptance_criteria: z.array(z.string()).optional().describe("New list of acceptance criteria"),
        notes: z.string().optional().describe("New notes"),
        dependencies: z.array(z.string()).optional().describe("New list of dependencies"),
        parent_id: z.string().optional().describe("New parent task ID")
      }
    },
    async (args: any) => {
      try {
        checkInit();
        let cmd = `backlog tasks edit ${args.taskId}`;
        if (args.title) cmd += ` --title ${escapeCmd(args.title)}`;
        if (args.description) cmd += ` --description ${escapeCmd(args.description)}`;
        if (args.status) cmd += ` --status ${escapeCmd(args.status)}`;
        if (args.priority) cmd += ` --priority ${args.priority}`;
        if (args.assignees) args.assignees.forEach((a: string) => cmd += ` -a ${escapeCmd(a)}`);
        if (args.labels) args.labels.forEach((l: string) => cmd += ` -l ${escapeCmd(l)}`);
        if (args.plan) cmd += ` --plan ${escapeCmd(args.plan)}`;
        if (args.acceptance_criteria) cmd += ` --acceptance-criteria ${escapeCmd(args.acceptance_criteria.join(","))}`;
        if (args.notes) cmd += ` --notes ${escapeCmd(args.notes)}`;
        if (args.dependencies) cmd += ` --dep ${escapeCmd(args.dependencies.join(","))}`;
        if (args.parent_id) cmd += ` --parent ${escapeCmd(args.parent_id)}`;
        
        const { stdout } = await execAsync(cmd, { cwd, timeout: 15000 });
        return { content: [{ type: "text", text: stdout || "Task edited" }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  // Tool: List Docs
  server.registerTool(
    "list-docs",
    { inputSchema: {} },
    async () => {
      try {
        checkInit();
        const { stdout } = await execAsync("backlog doc list --plain", { cwd, timeout: 10000 });
        return { content: [{ type: "text", text: stdout || "No documents found" }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  // Tool: View Doc
  server.registerTool(
    "view-doc",
    { inputSchema: { docId: z.string().describe("Doc ID") } },
    async (args) => {
      const { docId } = args as any;
      try {
        checkInit();
        const docsDir = join(cwd, 'backlog', 'docs');
        if (!existsSync(docsDir)) return { content: [{ type: "text", text: "Docs directory not found." }], isError: true };
        const files = readdirSync(docsDir);
        const docFile = files.find(f => f.startsWith(`${docId} - `) || f === `${docId}.md`);
        if (!docFile) return { content: [{ type: "text", text: "Doc not found" }], isError: true };
        const content = readFileSync(join(docsDir, docFile), 'utf-8');
        return { content: [{ type: "text", text: content }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  return server;
}

const mcpSessions = new Map<string, {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
  path: string;
}>();

app.get("/", (req, res) => {
  res.json({ name: "Backlog MCP Server", version: "1.0.0", endpoints: { mcp: `${BASE_URL}/sse` } });
});

app.post("/sse", async (req, res) => {
  req.headers.accept = 'application/json, text/event-stream';
  const sessionId = (req.headers["mcp-session-id"] || req.query.sessionId) as string;
  console.log(`📨 [POST] Method: ${req.body?.method}, Session: ${sessionId || 'new'}, Path: ${req.query.path}`);
  try {
    if (sessionId && mcpSessions.has(sessionId)) {
      const session = mcpSessions.get(sessionId)!;
      await session.transport.handleRequest(req, res, req.body);
      return;
    }
    if (req.body.method === "initialize") {
      const projectPath = req.query.path as string;
      if (!projectPath) return res.status(400).json({ error: "Path parameter required" });
      const newSessionId = randomUUID();
      const server = createMcpServer(projectPath);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => newSessionId });
      mcpSessions.set(newSessionId, { server, transport, path: projectPath });
      transport.onclose = async () => { mcpSessions.delete(newSessionId); };
      await server.connect(transport);
      res.setHeader("Mcp-Session-Id", newSessionId);
      await transport.handleRequest(req, res, req.body);
      return;
    }
    res.status(400).json({ error: "Session ID required" });
  } catch (error: any) {
    console.error("💥 POST Error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.get("/sse", async (req, res) => {
  req.headers.accept = 'application/json, text/event-stream';
  let sessionId = (req.headers["mcp-session-id"] || req.query.sessionId) as string;
  const projectPath = req.query.path as string;
  console.log(`📡 [GET] Session: ${sessionId || 'none'}, Path: ${projectPath || 'none'}`);
  if (!sessionId && projectPath) {
    sessionId = randomUUID();
    console.log(`✨ Auto-session via GET: ${sessionId}`);
    const server = createMcpServer(projectPath);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => sessionId });
    mcpSessions.set(sessionId, { server, transport, path: projectPath });
    transport.onclose = async () => { mcpSessions.delete(sessionId); };
    await server.connect(transport);
    res.setHeader("Mcp-Session-Id", sessionId);
  }
  const session = mcpSessions.get(sessionId);
  if (!session) return res.status(400).json({ error: "Invalid session ID" });
  await session.transport.handleRequest(req, res);
});

app.delete("/sse", async (req, res) => {
  const sessionId = (req.headers["mcp-session-id"] || req.query.sessionId) as string;
  const session = mcpSessions.get(sessionId);
  if (session) {
    await session.transport.handleRequest(req, res, req.body);
    mcpSessions.delete(sessionId);
  } else {
    res.status(404).end();
  }
});

const PORT = process.env.PORT || 8081;
app.listen(PORT, () => {
  console.log(`🚀 Backlog MCP Server running at ${BASE_URL}`);
  console.log(`📂 Root Mapped: ${HOST_ROOT} -> ${CONTAINER_DATA}`);
});
