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
app.use(cors());

const HOST_ROOT = process.env.HOST_ROOT || "/home/ferreirase/Documents";
const CONTAINER_DATA = "/data";
const BASE_URL = process.env.BASE_URL || "http://localhost:8081";
const DEFAULT_PROJECT_PATH = process.env.DEFAULT_PROJECT_PATH || HOST_ROOT;

function resolvePath(inputPath: string): string {
  if (inputPath.startsWith(HOST_ROOT)) {
    return inputPath.replace(HOST_ROOT, CONTAINER_DATA);
  }
  return inputPath;
}

interface SessionState {
  currentPath: string;
}

function createMcpServer(sessionState: SessionState) {
  const server = new McpServer({ 
    name: "backlog-mcp-server", 
    version: "1.1.0" 
  });

  const getEffectivePath = (providedPath?: string) => {
    if (providedPath) {
      sessionState.currentPath = providedPath;
    }
    return resolvePath(sessionState.currentPath);
  };

  const checkInit = (cwd: string) => {
    if (!existsSync(join(cwd, 'backlog'))) {
      throw new Error(`No Backlog.md project found at ${cwd}. Please run 'init-project' first with the correct 'path'.`);
    }
  };

  const pathDescription = "Absolute host path of the project (e.g. /home/ferreirase/Documents/ProjectA). This parameter is 'sticky': once provided in a session, it will be remembered for subsequent tool calls until changed.";

  const escapeCmd = (val: string) => `"${val.replace(/"/g, '\\"')}"`;

  // Tool: Init Project
  server.registerTool(
    "init-project",
    { 
      title: "Initialize Backlog Project",
      description: "Initializes a new Backlog.md structure in the specified directory. Use this if the project doesn't have a 'backlog' folder yet.",
      inputSchema: { 
        path: z.string().optional().describe(pathDescription),
        projectName: z.string().optional().describe("Optional project name. Defaults to the folder name.")
      } 
    },
    async (args: any) => {
      try {
        const cwd = getEffectivePath(args.path);
        const name = args.projectName || basename(cwd);
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
      title: "List Backlog Tasks",
      description: "Retrieves a list of tasks from the project backlog. Can be filtered by status, assignee, or priority.",
      inputSchema: {
        path: z.string().optional().describe(pathDescription),
        status: z.string().optional().describe("Filter by status (e.g. 'todo', 'doing', 'done')"),
        assignee: z.string().optional().describe("Filter by assignee (e.g. '@user')"),
        priority: z.enum(["high", "medium", "low"]).optional().describe("Filter by priority")
      }
    },
    async (args: any) => {
      try {
        const cwd = getEffectivePath(args.path);
        checkInit(cwd);
        let cmd = "backlog tasks list --plain";
        if (args.status) cmd += ` --status ${escapeCmd(args.status)}`;
        if (args.assignee) cmd += ` --assignee ${escapeCmd(args.assignee)}`;
        if (args.priority) cmd += ` --priority ${args.priority}`;
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
    { 
      title: "View Task Details",
      description: "Shows all details for a specific task including description, plan, and acceptance criteria.",
      inputSchema: { 
        taskId: z.string().describe("The ID of the task (e.g. '1', 'task-1')"),
        path: z.string().optional().describe(pathDescription)
      } 
    },
    async (args: any) => {
      try {
        const cwd = getEffectivePath(args.path);
        checkInit(cwd);
        const { stdout } = await execAsync(`backlog tasks view ${args.taskId} --plain`, { cwd, timeout: 10000 });
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
      title: "Create New Task",
      description: "Creates a new task in the project backlog with all provided fields.",
      inputSchema: {
        title: z.string().describe("Task title"),
        path: z.string().optional().describe(pathDescription),
        description: z.string().optional().describe("Detailed description"),
        status: z.string().optional().describe("Initial status"),
        priority: z.enum(["high", "medium", "low"]).optional().describe("Task priority"),
        assignees: z.array(z.string()).optional().describe("List of assignees (e.g. ['@user'])"),
        labels: z.array(z.string()).optional().describe("List of labels"),
        plan: z.string().optional().describe("Implementation plan steps"),
        acceptance_criteria: z.array(z.string()).optional().describe("List of acceptance criteria strings"),
        notes: z.string().optional().describe("Additional implementation notes"),
        dependencies: z.array(z.string()).optional().describe("Task IDs that this task depends on"),
        parent_id: z.string().optional().describe("ID of the parent task if this is a subtask"),
        is_draft: z.boolean().optional().describe("If true, initializes the task as a draft")
      }
    },
    async (args: any) => {
      try {
        const cwd = getEffectivePath(args.path);
        checkInit(cwd);
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
      title: "Edit Existing Task",
      description: "Updates fields of an existing task. Only provided fields will be updated.",
      inputSchema: {
        taskId: z.string().describe("Task ID to edit"),
        path: z.string().optional().describe(pathDescription),
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
        const cwd = getEffectivePath(args.path);
        checkInit(cwd);
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
    { 
      title: "List Backlog Documents",
      description: "Lists all Markdown documents in the project's backlog/docs folder.",
      inputSchema: { 
        path: z.string().optional().describe(pathDescription) 
      } 
    }, 
    async (args: any) => {
      try {
        const cwd = getEffectivePath(args.path);
        checkInit(cwd);
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
    { 
      title: "View Document Content",
      description: "Reads and returns the content of a specific Markdown document from the backlog.",
      inputSchema: { 
        docId: z.string().describe("Document ID (e.g. 'doc-1')"),
        path: z.string().optional().describe(pathDescription)
      } 
    }, 
    async (args: any) => {
      try {
        const cwd = getEffectivePath(args.path);
        checkInit(cwd);
        const docsDir = join(cwd, 'backlog', 'docs');
        const files = readdirSync(docsDir);
        const docFile = files.find(f => f.startsWith(`${args.docId} - `) || f === `${args.docId}.md`);
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

const sessions = new Map<string, { server: McpServer, transport: StreamableHTTPServerTransport, state: SessionState }>();

app.get("/sse", async (req, res) => {
  const sessionId = randomUUID();
  const initialPath = (req.query.path as string) || DEFAULT_PROJECT_PATH;
  
  console.log(`📡 [SSE] New session: ${sessionId} (Initial path: ${initialPath})`);

  const state: SessionState = { currentPath: initialPath };
  const server = createMcpServer(state);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => sessionId });
  
  sessions.set(sessionId, { server, transport, state });
  transport.onclose = () => sessions.delete(sessionId);

  await server.connect(transport);
  await transport.handleRequest(req, res);
});

app.post("/sse", async (req, res) => {
  const sessionId = (req.headers["mcp-session-id"] || req.query.sessionId) as string;
  const session = sessions.get(sessionId);
  if (!session) return res.status(400).json({ error: "Unknown session" });
  await session.transport.handleRequest(req, res, req.body);
});

app.get("/health", (req, res) => res.json({ status: "ok", active_sessions: sessions.size }));
app.get("/", (req, res) => res.json({ name: "Backlog MCP Dynamic Server", version: "1.1.0" }));

const PORT = parseInt(process.env.PORT || "8081");
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server ready on port ${PORT}`);
  console.log(`📂 Default project: ${DEFAULT_PROJECT_PATH}`);
});
