import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { exec } from "child_process";
import { promisify } from "util";
import { existsSync, readdirSync, readFileSync } from "fs";
import { join, basename } from "path";

const execAsync = promisify(exec);

const HOST_ROOT = process.env.HOST_ROOT || "/home/ferreirase/Documents";
const CONTAINER_DATA = "/data";
const DEFAULT_PROJECT_PATH = process.env.DEFAULT_PROJECT_PATH || HOST_ROOT;

// Session-based path memory
const sessionPaths = new Map<string, string>();

function resolvePath(inputPath: string): string {
  if (inputPath.startsWith(HOST_ROOT)) {
    return inputPath.replace(HOST_ROOT, CONTAINER_DATA);
  }
  return inputPath;
}

function getEffectivePath(sessionId: string, providedPath?: string) {
  if (providedPath) {
    sessionPaths.set(sessionId, providedPath);
  }
  const path = sessionPaths.get(sessionId) || DEFAULT_PROJECT_PATH;
  return resolvePath(path);
}

const checkInit = (cwd: string) => {
  if (!existsSync(join(cwd, "backlog"))) {
    throw new Error(`No Backlog.md project found at ${cwd}. Please run 'init-project' first.`);
  }
};

const escapeCmd = (val: string) => `"${val.replace(/"/g, '\\"')}"`;

const pathDescription = "Absolute host path of the project. Sticky: remembered for subsequent calls.";

export const initProjectTool = createTool({
  id: "init-project",
  description: "Initializes a new Backlog.md structure in the specified directory.",
  inputSchema: z.object({
    path: z.string().optional().describe(pathDescription),
    projectName: z.string().optional().describe("Optional project name"),
  }),
  execute: async ({ path, projectName }, context) => {
    const sessionId = (context?.mcp?.extra as any)?.sessionId || "default";
    const cwd = getEffectivePath(sessionId, path);
    const name = projectName || basename(cwd);
    try {
      const { stdout } = await execAsync(`backlog init ${escapeCmd(name)} --defaults`, { cwd, timeout: 25000 });
      return { success: true, message: stdout || "Project initialized" };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
});

export const listTasksTool = createTool({
  id: "list-tasks",
  description: "Retrieves a list of tasks from the project backlog.",
  inputSchema: z.object({
    path: z.string().optional().describe(pathDescription),
    status: z.string().optional().describe("Filter by status"),
    assignee: z.string().optional().describe("Filter by assignee"),
    priority: z.enum(["high", "medium", "low"]).optional().describe("Filter by priority"),
  }),
  execute: async ({ path, status, assignee, priority }, context) => {
    const sessionId = (context?.mcp?.extra as any)?.sessionId || "default";
    const cwd = getEffectivePath(sessionId, path);
    try {
      checkInit(cwd);
      let cmd = "backlog tasks list --plain";
      if (status) cmd += ` --status ${escapeCmd(status)}`;
      if (assignee) cmd += ` --assignee ${escapeCmd(assignee)}`;
      if (priority) cmd += ` --priority ${priority}`;
      const { stdout } = await execAsync(cmd, { cwd, timeout: 10000 });
      return { tasks: stdout || "No tasks found" };
    } catch (error: any) {
      return { error: error.message };
    }
  },
});

export const viewTaskTool = createTool({
  id: "view-task",
  description: "Shows all details for a specific task.",
  inputSchema: z.object({
    taskId: z.string().describe("The ID of the task"),
    path: z.string().optional().describe(pathDescription),
  }),
  execute: async ({ taskId, path }, context) => {
    const sessionId = (context?.mcp?.extra as any)?.sessionId || "default";
    const cwd = getEffectivePath(sessionId, path);
    try {
      checkInit(cwd);
      const { stdout } = await execAsync(`backlog tasks view ${taskId} --plain`, { cwd, timeout: 10000 });
      return { details: stdout || "Task not found" };
    } catch (error: any) {
      return { error: error.message };
    }
  },
});

export const createTaskTool = createTool({
  id: "create-task",
  description: "Creates a new task in the project backlog.",
  inputSchema: z.object({
    title: z.string().describe("Task title"),
    path: z.string().optional().describe(pathDescription),
    description: z.string().optional(),
    status: z.string().optional(),
    priority: z.enum(["high", "medium", "low"]).optional(),
    assignees: z.array(z.string()).optional(),
    labels: z.array(z.string()).optional(),
    plan: z.string().optional(),
    acceptance_criteria: z.array(z.string()).optional(),
    notes: z.string().optional(),
    dependencies: z.array(z.string()).optional(),
    parent_id: z.string().optional(),
    is_draft: z.boolean().optional(),
  }),
  execute: async ({ title, path, description, status, priority, assignees, labels, plan, acceptance_criteria, notes, dependencies, parent_id, is_draft }, context) => {
    const sessionId = (context?.mcp?.extra as any)?.sessionId || "default";
    const cwd = getEffectivePath(sessionId, path);
    try {
      checkInit(cwd);
      let cmd = `backlog tasks create ${escapeCmd(title)}`;
      if (description) cmd += ` --description ${escapeCmd(description)}`;
      if (status) cmd += ` --status ${escapeCmd(status)}`;
      if (priority) cmd += ` --priority ${priority}`;
      if (assignees) assignees.forEach((a: string) => (cmd += ` -a ${escapeCmd(a)}`));
      if (labels) labels.forEach((l: string) => (cmd += ` -l ${escapeCmd(l)}`));
      if (plan) cmd += ` --plan ${escapeCmd(plan)}`;
      if (acceptance_criteria) acceptance_criteria.forEach((ac: string) => (cmd += ` --ac ${escapeCmd(ac)}`));
      if (notes) cmd += ` --notes ${escapeCmd(notes)}`;
      if (dependencies) dependencies.forEach((d: string) => (cmd += ` --dep ${escapeCmd(d)}`));
      if (parent_id) cmd += ` --parent ${escapeCmd(parent_id)}`;
      if (is_draft) cmd += ` --draft`;

      const { stdout } = await execAsync(cmd, { cwd, timeout: 15000 });
      return { result: stdout || "Task created" };
    } catch (error: any) {
      return { error: error.message };
    }
  },
});

export const editTaskTool = createTool({
  id: "edit-task",
  description: "Updates fields of an existing task.",
  inputSchema: z.object({
    taskId: z.string().describe("Task ID to edit"),
    path: z.string().optional().describe(pathDescription),
    title: z.string().optional(),
    description: z.string().optional(),
    status: z.string().optional(),
    priority: z.enum(["high", "medium", "low"]).optional(),
    assignees: z.array(z.string()).optional(),
    labels: z.array(z.string()).optional(),
    plan: z.string().optional(),
    acceptance_criteria: z.array(z.string()).optional(),
    notes: z.string().optional(),
    dependencies: z.array(z.string()).optional(),
    parent_id: z.string().optional(),
  }),
  execute: async ({ taskId, path, title, description, status, priority, assignees, labels, plan, acceptance_criteria, notes, dependencies, parent_id }, context) => {
    const sessionId = (context?.mcp?.extra as any)?.sessionId || "default";
    const cwd = getEffectivePath(sessionId, path);
    try {
      checkInit(cwd);
      let cmd = `backlog tasks edit ${taskId}`;
      if (title) cmd += ` --title ${escapeCmd(title)}`;
      if (description) cmd += ` --description ${escapeCmd(description)}`;
      if (status) cmd += ` --status ${escapeCmd(status)}`;
      if (priority) cmd += ` --priority ${priority}`;
      if (assignees) assignees.forEach((a: string) => (cmd += ` -a ${escapeCmd(a)}`));
      if (labels) labels.forEach((l: string) => (cmd += ` -l ${escapeCmd(l)}`));
      if (plan) cmd += ` --plan ${escapeCmd(plan)}`;
      if (acceptance_criteria) cmd += ` --acceptance-criteria ${escapeCmd(acceptance_criteria.join(","))}`;
      if (notes) cmd += ` --notes ${escapeCmd(notes)}`;
      if (dependencies) dependencies.forEach((d: string) => cmd += ` --dep ${escapeCmd(d)}`);
      if (parent_id) cmd += ` --parent ${escapeCmd(parent_id)}`;

      const { stdout } = await execAsync(cmd, { cwd, timeout: 15000 });
      return { result: stdout || "Task edited" };
    } catch (error: any) {
      return { error: error.message };
    }
  },
});

export const listDocsTool = createTool({
  id: "list-docs",
  description: "Lists all Markdown documents in the project's backlog.",
  inputSchema: z.object({
    path: z.string().optional().describe(pathDescription),
  }),
  execute: async ({ path }, context) => {
    const sessionId = (context?.mcp?.extra as any)?.sessionId || "default";
    const cwd = getEffectivePath(sessionId, path);
    try {
      checkInit(cwd);
      const { stdout } = await execAsync("backlog doc list --plain", { cwd, timeout: 10000 });
      return { docs: stdout || "No documents found" };
    } catch (error: any) {
      return { error: error.message };
    }
  },
});

export const viewDocTool = createTool({
  id: "view-doc",
  description: "Reads and returns the content of a specific Markdown document.",
  inputSchema: z.object({
    docId: z.string().describe("Document ID"),
    path: z.string().optional().describe(pathDescription),
  }),
  execute: async ({ docId, path }, context) => {
    const sessionId = (context?.mcp?.extra as any)?.sessionId || "default";
    const cwd = getEffectivePath(sessionId, path);
    try {
      checkInit(cwd);
      const docsDir = join(cwd, "backlog", "docs");
      const files = readdirSync(docsDir);
      const docFile = files.find((f) => f.startsWith(`${docId} - `) || f === `${docId}.md`);
      if (!docFile) throw new Error("Doc not found");
      const content = readFileSync(join(docsDir, docFile), "utf-8");
      return { content };
    } catch (error: any) {
      return { error: error.message };
    }
  },
});
