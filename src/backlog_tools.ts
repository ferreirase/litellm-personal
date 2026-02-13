
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { exec } from "child_process";
import { promisify } from "util";
import { existsSync, readdirSync, readFileSync } from "fs";
import { join, basename } from "path";
import { sessionManager } from "./session.js";

const execAsync = promisify(exec);

const checkInit = (cwd: string) => {
  if (!existsSync(join(cwd, "backlog"))) {
    throw new Error(`No Backlog.md project found at ${cwd}. Please run 'init-project' first.`);
  }
};

const escapeCmd = (val: string) => `"${val.replace(/"/g, '\\"')}"`;
const pathDescription = "Absolute host path of the project. Sticky: remembered for subsequent calls.";

// --- Tasks ---

export const taskList = createTool({
  id: "task_list",
  description: "Retrieves a list of tasks from the project backlog.",
  inputSchema: z.object({
    path: z.string().optional().describe(pathDescription),
    status: z.string().optional().describe("Filter by status"),
    assignee: z.string().optional().describe("Filter by assignee"),
    priority: z.enum(["high", "medium", "low"]).optional().describe("Filter by priority"),
  }),
  execute: async ({ path, status, assignee, priority }, context) => {
    const sessionId = sessionManager.getSessionId(context);
    const cwd = sessionManager.getEffectivePath(sessionId, path);
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

export const taskView = createTool({
  id: "task_view",
  description: "Shows all details for a specific task.",
  inputSchema: z.object({
    taskId: z.string().describe("The ID of the task"),
    path: z.string().optional().describe(pathDescription),
  }),
  execute: async ({ taskId, path }, context) => {
    const sessionId = sessionManager.getSessionId(context);
    const cwd = sessionManager.getEffectivePath(sessionId, path);
    try {
      checkInit(cwd);
      const { stdout } = await execAsync(`backlog tasks view ${taskId} --plain`, { cwd, timeout: 10000 });
      return { details: stdout || "Task not found" };
    } catch (error: any) {
      return { error: error.message };
    }
  },
});

export const taskCreate = createTool({
  id: "task_create",
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
    const sessionId = sessionManager.getSessionId(context);
    const cwd = sessionManager.getEffectivePath(sessionId, path);
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

export const taskEdit = createTool({
  id: "task_edit",
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
    const sessionId = sessionManager.getSessionId(context);
    const cwd = sessionManager.getEffectivePath(sessionId, path);
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

export const taskComplete = createTool({
  id: "task_complete",
  description: "Marks a task as completed.",
  inputSchema: z.object({
    taskId: z.string().describe("Task ID"),
    path: z.string().optional().describe(pathDescription),
  }),
  execute: async ({ taskId, path }, context) => {
    const sessionId = sessionManager.getSessionId(context);
    const cwd = sessionManager.getEffectivePath(sessionId, path);
    try {
      checkInit(cwd);
      const { stdout } = await execAsync(`backlog tasks complete ${taskId}`, { cwd, timeout: 10000 });
      return { result: stdout || "Task completed" };
    } catch (error: any) {
      return { error: error.message };
    }
  },
});

export const taskArchive = createTool({
  id: "task_archive",
  description: "Archives a task.",
  inputSchema: z.object({
    taskId: z.string().describe("Task ID"),
    path: z.string().optional().describe(pathDescription),
  }),
  execute: async ({ taskId, path }, context) => {
    const sessionId = sessionManager.getSessionId(context);
    const cwd = sessionManager.getEffectivePath(sessionId, path);
    try {
      checkInit(cwd);
      const { stdout } = await execAsync(`backlog tasks archive ${taskId}`, { cwd, timeout: 10000 });
      return { result: stdout || "Task archived" };
    } catch (error: any) {
      return { error: error.message };
    }
  },
});

export const taskSearch = createTool({
  id: "task_search",
  description: "Search for tasks using a text query.",
  inputSchema: z.object({
    query: z.string().describe("Search query"),
    path: z.string().optional().describe(pathDescription),
  }),
  execute: async ({ query, path }, context) => {
    const sessionId = sessionManager.getSessionId(context);
    const cwd = sessionManager.getEffectivePath(sessionId, path);
    try {
      checkInit(cwd);
      const { stdout } = await execAsync(`backlog tasks search ${escapeCmd(query)} --plain`, { cwd, timeout: 10000 });
      return { tasks: stdout || "No tasks found" };
    } catch (error: any) {
      return { error: error.message };
    }
  },
});

// --- Documents ---

export const documentList = createTool({
  id: "document_list",
  description: "Lists all Markdown documents in the project's backlog.",
  inputSchema: z.object({
    path: z.string().optional().describe(pathDescription),
  }),
  execute: async ({ path }, context) => {
    const sessionId = sessionManager.getSessionId(context);
    const cwd = sessionManager.getEffectivePath(sessionId, path);
    try {
      checkInit(cwd);
      const { stdout } = await execAsync("backlog doc list --plain", { cwd, timeout: 10000 });
      return { docs: stdout || "No documents found" };
    } catch (error: any) {
      return { error: error.message };
    }
  },
});

export const documentView = createTool({
  id: "document_view",
  description: "Reads and returns the content of a specific Markdown document.",
  inputSchema: z.object({
    docId: z.string().describe("Document ID"),
    path: z.string().optional().describe(pathDescription),
  }),
  execute: async ({ docId, path }, context) => {
    const sessionId = sessionManager.getSessionId(context);
    const cwd = sessionManager.getEffectivePath(sessionId, path);
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

export const documentCreate = createTool({
  id: "document_create",
  description: "Creates a new Markdown document.",
  inputSchema: z.object({
    title: z.string().describe("Doc title"),
    content: z.string().optional(),
    path: z.string().optional().describe(pathDescription),
  }),
  execute: async ({ title, content, path }, context) => {
    const sessionId = sessionManager.getSessionId(context);
    const cwd = sessionManager.getEffectivePath(sessionId, path);
    try {
      checkInit(cwd);
      let cmd = `backlog doc create ${escapeCmd(title)}`;
      if (content) cmd += ` --content ${escapeCmd(content)}`;
      const { stdout } = await execAsync(cmd, { cwd, timeout: 10000 });
      return { result: stdout || "Doc created" };
    } catch (error: any) {
      return { error: error.message };
    }
  },
});

export const documentUpdate = createTool({
  id: "document_update",
  description: "Updates an existing document.",
  inputSchema: z.object({
    docId: z.string().describe("Doc ID"),
    title: z.string().optional(),
    content: z.string().optional(),
    path: z.string().optional().describe(pathDescription),
  }),
  execute: async ({ docId, title, content, path }, context) => {
    const sessionId = sessionManager.getSessionId(context);
    const cwd = sessionManager.getEffectivePath(sessionId, path);
    try {
      checkInit(cwd);
      let cmd = `backlog doc edit ${docId}`;
      if (title) cmd += ` --title ${escapeCmd(title)}`;
      if (content) cmd += ` --content ${escapeCmd(content)}`;
      const { stdout } = await execAsync(cmd, { cwd, timeout: 10000 });
      return { result: stdout || "Doc updated" };
    } catch (error: any) {
      return { error: error.message };
    }
  },
});

export const documentSearch = createTool({
  id: "document_search",
  description: "Search for documents using a text query.",
  inputSchema: z.object({
    query: z.string().describe("Search query"),
    path: z.string().optional().describe(pathDescription),
  }),
  execute: async ({ query, path }, context) => {
    const sessionId = sessionManager.getSessionId(context);
    const cwd = sessionManager.getEffectivePath(sessionId, path);
    try {
      checkInit(cwd);
      const { stdout } = await execAsync(`backlog doc search ${escapeCmd(query)} --plain`, { cwd, timeout: 10000 });
      return { docs: stdout || "No docs found" };
    } catch (error: any) {
      return { error: error.message };
    }
  },
});

// --- Milestones ---

export const milestoneList = createTool({
  id: "milestone_list",
  description: "Lists all milestones.",
  inputSchema: z.object({
    path: z.string().optional().describe(pathDescription),
  }),
  execute: async ({ path }, context) => {
    const sessionId = sessionManager.getSessionId(context);
    const cwd = sessionManager.getEffectivePath(sessionId, path);
    try {
      checkInit(cwd);
      const { stdout } = await execAsync("backlog milestone list", { cwd, timeout: 10000 });
      return { milestones: stdout || "No milestones found" };
    } catch (error: any) {
      return { error: error.message };
    }
  },
});

export const milestoneAdd = createTool({
  id: "milestone_add",
  description: "Adds a new milestone.",
  inputSchema: z.object({
    name: z.string().describe("Milestone name"),
    path: z.string().optional().describe(pathDescription),
  }),
  execute: async ({ name, path }, context) => {
    const sessionId = sessionManager.getSessionId(context);
    const cwd = sessionManager.getEffectivePath(sessionId, path);
    try {
      checkInit(cwd);
      const { stdout } = await execAsync(`backlog milestone add ${escapeCmd(name)}`, { cwd, timeout: 10000 });
      return { result: stdout || "Milestone added" };
    } catch (error: any) {
      return { error: error.message };
    }
  },
});

export const milestoneRename = createTool({
  id: "milestone_rename",
  description: "Renames an existing milestone.",
  inputSchema: z.object({
    oldName: z.string().describe("Old name"),
    newName: z.string().describe("New name"),
    path: z.string().optional().describe(pathDescription),
  }),
  execute: async ({ oldName, newName, path }, context) => {
    const sessionId = sessionManager.getSessionId(context);
    const cwd = sessionManager.getEffectivePath(sessionId, path);
    try {
      checkInit(cwd);
      const { stdout } = await execAsync(`backlog milestone rename ${escapeCmd(oldName)} ${escapeCmd(newName)}`, { cwd, timeout: 10000 });
      return { result: stdout || "Milestone renamed" };
    } catch (error: any) {
      return { error: error.message };
    }
  },
});

export const milestoneRemove = createTool({
  id: "milestone_remove",
  description: "Removes a milestone.",
  inputSchema: z.object({
    name: z.string().describe("Milestone name"),
    path: z.string().optional().describe(pathDescription),
  }),
  execute: async ({ name, path }, context) => {
    const sessionId = sessionManager.getSessionId(context);
    const cwd = sessionManager.getEffectivePath(sessionId, path);
    try {
      checkInit(cwd);
      const { stdout } = await execAsync(`backlog milestone remove ${escapeCmd(name)}`, { cwd, timeout: 10000 });
      return { result: stdout || "Milestone removed" };
    } catch (error: any) {
      return { error: error.message };
    }
  },
});

// --- Workflow Guides (Tools) ---

export const getWorkflowOverview = createTool({
  id: "get_workflow_overview",
  description: "Returns the general workflow overview for the project.",
  inputSchema: z.object({ path: z.string().optional().describe(pathDescription) }),
  execute: async ({ path }, context) => {
    const sessionId = sessionManager.getSessionId(context);
    const cwd = sessionManager.getEffectivePath(sessionId, path);
    try {
      const { stdout } = await execAsync("backlog workflow overview", { cwd, timeout: 10000 });
      return { content: stdout };
    } catch (error: any) { return { error: error.message }; }
  },
});

export const getTaskCreationGuide = createTool({
  id: "get_task_creation_guide",
  description: "Returns the guide for creating tasks.",
  inputSchema: z.object({ path: z.string().optional().describe(pathDescription) }),
  execute: async ({ path }, context) => {
    const sessionId = sessionManager.getSessionId(context);
    const cwd = sessionManager.getEffectivePath(sessionId, path);
    try {
      const { stdout } = await execAsync("backlog workflow task-creation", { cwd, timeout: 10000 });
      return { content: stdout };
    } catch (error: any) { return { error: error.message }; }
  },
});

export const getTaskExecutionGuide = createTool({
  id: "get_task_execution_guide",
  description: "Returns the guide for executing tasks.",
  inputSchema: z.object({ path: z.string().optional().describe(pathDescription) }),
  execute: async ({ path }, context) => {
    const sessionId = sessionManager.getSessionId(context);
    const cwd = sessionManager.getEffectivePath(sessionId, path);
    try {
      const { stdout } = await execAsync("backlog workflow task-execution", { cwd, timeout: 10000 });
      return { content: stdout };
    } catch (error: any) { return { error: error.message }; }
  },
});

export const getTaskCompletionGuide = createTool({
  id: "get_task_completion_guide",
  description: "Returns the guide for completing tasks.",
  inputSchema: z.object({ path: z.string().optional().describe(pathDescription) }),
  execute: async ({ path }, context) => {
    const sessionId = sessionManager.getSessionId(context);
    const cwd = sessionManager.getEffectivePath(sessionId, path);
    try {
      const { stdout } = await execAsync("backlog workflow task-completion", { cwd, timeout: 10000 });
      return { content: stdout };
    } catch (error: any) { return { error: error.message }; }
  },
});

// --- Project Init ---

export const initProjectTool = createTool({
  id: "init_project",
  description: "Initializes a new Backlog.md structure.",
  inputSchema: z.object({
    path: z.string().optional().describe(pathDescription),
    projectName: z.string().optional().describe("Optional project name"),
  }),
  execute: async ({ path, projectName }, context) => {
    const sessionId = sessionManager.getSessionId(context);
    const cwd = sessionManager.getEffectivePath(sessionId, path);
    const name = projectName || basename(cwd);
    try {
      const { stdout } = await execAsync(`backlog init ${escapeCmd(name)} --defaults`, { cwd, timeout: 25000 });
      return { success: true, message: stdout || "Project initialized" };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
});

// Backlog Resources (Workflow Guides)
export const backlogResources = {
  listResources: async () => [
    { uri: "backlog://workflow/overview", name: "Backlog Workflow Overview", mimeType: "text/markdown" },
    { uri: "backlog://workflow/task-creation", name: "Task Creation Guide", mimeType: "text/markdown" },
    { uri: "backlog://workflow/task-execution", name: "Task Execution Guide", mimeType: "text/markdown" },
    { uri: "backlog://workflow/task-completion", name: "Task Completion Guide", mimeType: "text/markdown" },
  ],
  getResourceContent: async ({ uri }: { uri: string }) => {
    const contents: Record<string, string> = {
      "backlog://workflow/overview": "# Backlog Workflow Overview\n\nThis guide covers the overall workflow...",
      "backlog://workflow/task-creation": "# Task Creation Guide\n\nBest practices for creating tasks...",
      "backlog://workflow/task-execution": "# Task Execution Guide\n\nHow to execute tasks effectively...",
      "backlog://workflow/task-completion": "# Task Completion Guide\n\nSteps to complete and archive tasks...",
    };
    const text = contents[uri];
    if (!text) throw new Error(`Resource not found: ${uri}`);
    return { text };
  },
};

export const backlogTools = {
  init_project: initProjectTool,
  task_list: taskList,
  task_view: taskView,
  task_create: taskCreate,
  task_edit: taskEdit,
  task_complete: taskComplete,
  task_archive: taskArchive,
  task_search: taskSearch,
  document_list: documentList,
  document_view: documentView,
  document_create: documentCreate,
  document_update: documentUpdate,
  document_search: documentSearch,
  milestone_list: milestoneList,
  milestone_add: milestoneAdd,
  milestone_rename: milestoneRename,
  milestone_remove: milestoneRemove,
  get_workflow_overview: getWorkflowOverview,
  get_task_creation_guide: getTaskCreationGuide,
  get_task_execution_guide: getTaskExecutionGuide,
  get_task_completion_guide: getTaskCompletionGuide,
};
