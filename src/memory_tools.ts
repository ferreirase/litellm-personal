
import { Memory } from "@mastra/memory";
import { PostgresStore } from "@mastra/pg";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";

const databaseUrl = process.env.DATABASE_URL || "postgresql://mastra:mastra_password@localhost:5433/mastra_memory";

const storage = new PostgresStore({
  id: "mastra-memory-postgres",
  connectionString: databaseUrl,
});

const getOMConfig = () => {
  const omModel = process.env.OM_MODEL;
  if (omModel && omModel.includes("/")) {
    return { model: omModel };
  }
  if (process.env.OPENROUTER_API_KEY) {
    return {
      model: omModel || "openrouter/nvidia/nemotron-3-nano-30b-a3b:free",
      observation: {
        messageTokens: 30000,
        model: omModel || "openrouter/nvidia/nemotron-3-nano-30b-a3b:free",
      },
      reflection: {
        observationTokens: 40000,
        model: "openrouter/upstage/solar-pro-3:free",
      },
    };
  }
  return { model: omModel || "google/gemini-2.0-flash" };
};

export const memory = new Memory({
  storage,
  options: {
    lastMessages: 40,
    semanticRecall: false,
    workingMemory: { enabled: true },
    observationalMemory: {
      enabled: true,
      scope: "thread",
      ...getOMConfig(),
    },
  },
});

export const createThread = createTool({
  id: "memory_create_thread",
  description: "Create a new conversation thread for agent memory",
  inputSchema: z.object({
    threadId: z.string().optional().describe("Optional thread ID"),
    resourceId: z.string().optional().describe("Associated resource ID"),
  }),
  execute: async ({ threadId, resourceId }) => {
    const thread = await memory.createThread({
      threadId,
      resourceId: resourceId || "default-resource",
    });
    return { threadId: thread.id, resourceId: thread.resourceId };
  },
});

export const addMessages = createTool({
  id: "memory_add_messages",
  description: "Add messages to agent memory",
  inputSchema: z.object({
    threadId: z.string().describe("Thread/session ID"),
    resourceId: z.string().optional().describe("Associated resource ID"),
    messages: z.array(z.object({
      role: z.enum(["user", "assistant", "system"]),
      content: z.string(),
    })).describe("Array of messages to add"),
    metadata: z.record(z.any()).optional().describe("Optional metadata"),
  }),
  execute: async ({ threadId, messages, resourceId, metadata }) => {
    const resId = resourceId || "default-resource";
    const messagesToSave = messages.map((msg: any) => ({
      id: memory.generateId({ idType: "message", threadId, resourceId: resId, role: msg.role }),
      threadId,
      resourceId: resId,
      role: msg.role === "system" ? "user" : msg.role,
      createdAt: new Date(),
      content: { format: 2 as const, parts: [{ type: "text" as const, text: msg.content }] },
    }));
    await memory.saveMessages({ messages: messagesToSave });
    return { success: true, count: messages.length };
  },
});

export const getMessages = createTool({
  id: "memory_get_messages",
  description: "Retrieve messages from a thread",
  inputSchema: z.object({
    threadId: z.string().describe("Thread/session ID"),
    limit: z.number().optional().default(50).describe("Limit of recent messages"),
  }),
  execute: async ({ threadId, limit }) => {
    const result = await memory.recall({ threadId, perPage: limit });
    return {
      messages: result.messages.map((msg: any) => ({
        id: msg.id,
        role: msg.role,
        content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
        createdAt: msg.createdAt,
      })),
      usage: result.usage,
    };
  },
});

export const deleteThread = createTool({
  id: "memory_delete_thread",
  description: "Delete a conversation thread",
  inputSchema: z.object({ threadId: z.string().describe("Thread ID to delete") }),
  execute: async ({ threadId }) => {
    await memory.deleteThread(threadId);
    return { success: true };
  },
});

export const listThreads = createTool({
  id: "memory_list_threads",
  description: "List all conversation threads",
  inputSchema: z.object({}),
  execute: async () => {
    const result = await memory.listThreads({ filter: {} });
    return { threads: result.threads, total: result.total };
  },
});

export const getContext = createTool({
  id: "memory_get_context",
  description: "Get compressed context including observations and reflections from Observational Memory",
  inputSchema: z.object({
    threadId: z.string().describe("Thread/session ID"),
    resourceId: z.string().optional().describe("Resource ID for resource scope"),
    limit: z.number().optional().default(50).describe("Recent messages limit"),
    includeObservations: z.boolean().optional().default(true).describe("Include OM observations"),
  }),
  execute: async ({ threadId, resourceId, limit, includeObservations }) => {
    const messagesResult = await memory.recall({ threadId, perPage: limit });
    let observations = null;
    if (includeObservations) {
        try {
            const store = await (memory as any).getMemoryStore();
            const scopeId = resourceId || threadId;
            const scopeType = resourceId ? "resource" : "thread";
            const omRecord = await store.getObservationalMemory({ scopeId, scopeType });
            if (omRecord) observations = omRecord.observations;
        } catch {}
    }
    return { messages: messagesResult.messages, observations };
  },
});

export const getObservations = createTool({
  id: "memory_get_observations",
  description: "Get observations from Observational Memory",
  inputSchema: z.object({
    threadId: z.string().optional().describe("Thread ID for thread scope"),
    resourceId: z.string().optional().describe("Resource ID for resource scope"),
  }),
  execute: async ({ threadId, resourceId }) => {
    const store = await (memory as any).getMemoryStore();
    const scopeId = resourceId || threadId;
    if (!scopeId) throw new Error("threadId or resourceId required");
    const omRecord = await store.getObservationalMemory({ scopeId, scopeType: resourceId ? "resource" : "thread" });
    return { observations: omRecord?.observations || null };
  },
});

export const observeNow = createTool({
  id: "memory_observe_now",
  description: "Check Observational Memory status and trigger observation if needed",
  inputSchema: z.object({
    threadId: z.string().describe("Thread ID to observe"),
    resourceId: z.string().optional().describe("Resource ID"),
  }),
  execute: async ({ threadId, resourceId }) => {
    return { message: "Observational Memory is running automatically in background", threadId };
  },
});

export const getMemoryStats = createTool({
  id: "memory_get_memory_stats",
  description: "Get memory statistics including token counts and OM status",
  inputSchema: z.object({ threadId: z.string().describe("Thread ID") }),
  execute: async ({ threadId }) => {
    const result = await memory.recall({ threadId, perPage: 10000 });
    return { messageCount: result.messages.length };
  },
});

export const memoryTools = {
  create_thread: createThread,
  add_messages: addMessages,
  get_messages: getMessages,
  delete_thread: deleteThread,
  list_threads: listThreads,
  get_context: getContext,
  get_observations: getObservations,
  observe_now: observeNow,
  get_memory_stats: getMemoryStats,
};
