import "dotenv/config";
import express from "express";
import cors from "cors";
import { readFileSync, existsSync, readdirSync } from "fs";
import crypto from "crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { randomUUID } from "crypto";
import { join } from "path";
import { z } from "zod";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

const app = express();
app.use(express.json());

// ============= CORS =============
app.use(cors({
  origin: true,
  credentials: true,
  allowedHeaders: "*",
  exposedHeaders: ["Mcp-Session-Id"],
  methods: ["GET", "POST", "DELETE", "OPTIONS"]
}));

// ============= Configuração =============
const BACKLOG_PROJECT_PATH = process.env.BACKLOG_PROJECT_PATH || process.cwd();
const BASE_URL = process.env.BASE_URL || "http://localhost:8081";

console.log(`📁 Diretório do projeto backlog: ${BACKLOG_PROJECT_PATH}`);

// ============= OAuth Configuration =============
const registeredClients = new Map();
const authorizationCodes = new Map();
const accessTokens = new Map();

app.get("/", (req, res) => {
  res.json({
    name: "Backlog MCP Server",
    version: "1.0.0",
    transport: "streamable-http",
    endpoints: {
      mcp: `${BASE_URL}/sse`,
      health: `${BASE_URL}/health`,
      oauth: `${BASE_URL}/.well-known/oauth-authorization-server`
    }
  });
});

app.get("/.well-known/oauth-authorization-server", (req, res) => {
  res.json({
    issuer: BASE_URL,
    authorization_endpoint: `${BASE_URL}/authorize`,
    token_endpoint: `${BASE_URL}/token`,
    registration_endpoint: `${BASE_URL}/register`,
    code_challenge_methods_supported: ["S256"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    response_types_supported: ["code"],
    token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"],
    scopes_supported: ["mcp"]
  });
});

app.get("/.well-known/oauth-protected-resource", (req, res) => {
  res.json({
    resource: BASE_URL,
    authorization_servers: [BASE_URL],
    scopes_supported: ["mcp"],
    bearer_methods_supported: ["header"]
  });
});

app.get("/.well-known/oauth-protected-resource/sse", (req, res) => {
  res.json({
    resource: `${BASE_URL}/sse`,
    authorization_servers: [BASE_URL],
    scopes_supported: ["mcp"],
    bearer_methods_supported: ["header"]
  });
});

app.post("/register", (req, res) => {
  const clientId = `client_${crypto.randomBytes(16).toString("hex")}`;
  const clientSecret = crypto.randomBytes(32).toString("hex");

  const clientInfo = {
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uris: req.body.redirect_uris || [],
    grant_types: req.body.grant_types || ["authorization_code", "refresh_token"],
    response_types: req.body.response_types || ["code"],
    token_endpoint_auth_method: req.body.token_endpoint_auth_method || "client_secret_post",
    client_name: req.body.client_name || "MCP Client",
    scope: "mcp"
  };

  registeredClients.set(clientId, clientInfo);
  console.log(`✅ Cliente registrado: ${clientId}`);

  res.status(201).json({
    client_id_issued_at: Math.floor(Date.now() / 1000),
    ...clientInfo
  });
});

app.get("/authorize", (req, res) => {
  const { client_id, redirect_uri, code_challenge, code_challenge_method, state, scope } = req.query;

  const client = registeredClients.get(client_id as string);
  if (!client) {
    return res.status(400).json({ error: "invalid_client" });
  }

  if (!client.redirect_uris.includes(redirect_uri)) {
    return res.status(400).json({ error: "invalid_request", error_description: "Invalid redirect_uri" });
  }

  if (!code_challenge || code_challenge_method !== "S256") {
    return res.status(400).json({ error: "invalid_request", error_description: "PKCE S256 required" });
  }

  const authCode = crypto.randomBytes(32).toString("hex");
  authorizationCodes.set(authCode, {
    client_id,
    redirect_uri,
    code_challenge,
    code_challenge_method,
    scope: scope || "mcp",
    expiresAt: Date.now() + 600000
  });

  console.log(`✅ Código de autorização gerado`);
  const redirectUrl = `${redirect_uri}?code=${authCode}&state=${state}`;
  res.redirect(redirectUrl);
});

app.post("/token", (req, res) => {
  const { grant_type, code, client_id, client_secret, code_verifier } = req.body;

  const client = registeredClients.get(client_id);
  if (!client || client.client_secret !== client_secret) {
    return res.status(401).json({ error: "invalid_client" });
  }

  if (grant_type === "authorization_code") {
    const authData = authorizationCodes.get(code);
    if (!authData || authData.expiresAt < Date.now()) {
      return res.status(400).json({ error: "invalid_grant" });
    }

    const expectedChallenge = crypto.createHash("sha256").update(code_verifier).digest("base64url");
    if (expectedChallenge !== authData.code_challenge) {
      return res.status(400).json({ error: "invalid_grant", error_description: "PKCE verification failed" });
    }

    const accessToken = crypto.randomBytes(32).toString("hex");
    const newRefreshToken = crypto.randomBytes(32).toString("hex");

    accessTokens.set(accessToken, {
      client_id,
      scope: authData.scope,
      expiresAt: Date.now() + 3600000
    });

    authorizationCodes.delete(code);
    console.log(`✅ Access token gerado`);

    res.json({
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: newRefreshToken,
      scope: authData.scope
    });
  } else if (grant_type === "refresh_token") {
    const newAccessToken = crypto.randomBytes(32).toString("hex");
    accessTokens.set(newAccessToken, {
      client_id,
      scope: "mcp",
      expiresAt: Date.now() + 3600000
    });

    res.json({
      access_token: newAccessToken,
      token_type: "Bearer",
      expires_in: 3600,
      scope: "mcp"
    });
  } else {
    res.status(400).json({ error: "unsupported_grant_type" });
  }
});

// ============= MCP Server Factory (uma instância por sessão) =============
function createMcpServer() {
  const server = new McpServer({
    name: "backlog-tasks-server",
    version: "1.0.0"
  });

  // Tool: Listar Tasks
  server.registerTool(
    "list-tasks",
    {
      title: "List Tasks",
      description: "List all tasks from backlog, optionally filtered by status, assignee, parent, or priority",
      inputSchema: {
        status: z.string().optional().describe("Filter by status (e.g., 'todo', 'doing', 'done')"),
        assignee: z.string().optional().describe("Filter by assignee"),
        parent: z.string().optional().describe("Filter by parent task ID"),
        priority: z.enum(["high", "medium", "low"]).optional().describe("Filter by priority"),
        sort: z.enum(["priority", "id"]).optional().describe("Sort tasks by field")
      },
      outputSchema: {
        tasks: z.string()
      }
    },
    async ({ status, assignee, parent, priority, sort }) => {
      try {
        let cmd = "backlog tasks list --plain";
        if (status) cmd += ` --status "${status}"`;
        if (assignee) cmd += ` --assignee "${assignee}"`;
        if (parent) cmd += ` --parent "${parent}"`;
        if (priority) cmd += ` --priority ${priority}`;
        if (sort) cmd += ` --sort ${sort}`;

        const { stdout, stderr } = await execAsync(cmd, { cwd: BACKLOG_PROJECT_PATH });
        if (stderr) console.error(`stderr: ${stderr}`);

        return {
          content: [{ type: "text", text: stdout || "No tasks found" }],
          structuredContent: { tasks: stdout }
        };
      } catch (error: any) {
        return {
          content: [{ type: "text", text: `Error: ${error.message}` }],
          structuredContent: { tasks: "" },
          isError: true
        };
      }
    }
  );

  // Tool: Ver Detalhes da Task
  server.registerTool(
    "view-task",
    {
      title: "View Task Details",
      description: "Display detailed information about a specific task",
      inputSchema: {
        taskId: z.string().describe("The ID of the task to view")
      },
      outputSchema: {
        details: z.string()
      }
    },
    async ({ taskId }) => {
      try {
        const { stdout, stderr } = await execAsync(`backlog tasks view ${taskId} --plain`, { cwd: BACKLOG_PROJECT_PATH });
        if (stderr) console.error(`stderr: ${stderr}`);

        return {
          content: [{ type: "text", text: stdout || "Task not found" }],
          structuredContent: { details: stdout }
        };
      } catch (error: any) {
        return {
          content: [{ type: "text", text: `Error: ${error.message}` }],
          structuredContent: { details: "" },
          isError: true
        };
      }
    }
  );

  // Tool: Criar Task
  server.registerTool(
    "create-task",
    {
      title: "Create Task",
      description: "Create a new task in the backlog",
      inputSchema: {
        title: z.string().describe("The title of the task")
      },
      outputSchema: {
        result: z.string()
      }
    },
    async ({ title }) => {
      try {
        const { stdout, stderr } = await execAsync(`backlog tasks create "${title}"`, { cwd: BACKLOG_PROJECT_PATH });
        if (stderr) console.error(`stderr: ${stderr}`);

        return {
          content: [{ type: "text", text: stdout || "Task created successfully" }],
          structuredContent: { result: stdout }
        };
      } catch (error: any) {
        return {
          content: [{ type: "text", text: `Error: ${error.message}` }],
          structuredContent: { result: "" },
          isError: true
        };
      }
    }
  );

  // Tool: Editar Task
  server.registerTool(
    "edit-task",
    {
      title: "Edit Task",
      description: "Edit an existing task",
      inputSchema: {
        taskId: z.string().describe("The ID of the task to edit"),
        title: z.string().optional().describe("New title"),
        description: z.string().optional().describe("New description"),
        status: z.string().optional().describe("New status"),
        assignee: z.string().optional().describe("New assignee"),
        priority: z.enum(["high", "medium", "low"]).optional().describe("New priority")
      },
      outputSchema: {
        result: z.string()
      }
    },
    async ({ taskId, title, description, status, assignee, priority }) => {
      try {
        let cmd = `backlog tasks edit ${taskId}`;
        if (title) cmd += ` --title "${title}"`;
        if (description) cmd += ` --description "${description}"`;
        if (status) cmd += ` --status "${status}"`;
        if (assignee) cmd += ` --assignee "${assignee}"`;
        if (priority) cmd += ` --priority ${priority}`;

        const { stdout, stderr } = await execAsync(cmd, { cwd: BACKLOG_PROJECT_PATH });
        if (stderr) console.error(`stderr: ${stderr}`);

        return {
          content: [{ type: "text", text: stdout || "Task edited successfully" }],
          structuredContent: { result: stdout }
        };
      } catch (error: any) {
        return {
          content: [{ type: "text", text: `Error: ${error.message}` }],
          structuredContent: { result: "" },
          isError: true
        };
      }
    }
  );

  // Tool: Arquivar Task
  server.registerTool(
    "archive-task",
    {
      title: "Archive Task",
      description: "Archive a task",
      inputSchema: {
        taskId: z.string().describe("The ID of the task to archive")
      },
      outputSchema: {
        result: z.string()
      }
    },
    async ({ taskId }) => {
      try {
        const { stdout, stderr } = await execAsync(`backlog tasks archive ${taskId}`, { cwd: BACKLOG_PROJECT_PATH });
        if (stderr) console.error(`stderr: ${stderr}`);

        return {
          content: [{ type: "text", text: stdout || "Task archived successfully" }],
          structuredContent: { result: stdout }
        };
      } catch (error: any) {
        return {
          content: [{ type: "text", text: `Error: ${error.message}` }],
          structuredContent: { result: "" },
          isError: true
        };
      }
    }
  );

  // Tool: Demover Task
  server.registerTool(
    "demote-task",
    {
      title: "Demote Task",
      description: "Move task back to drafts",
      inputSchema: {
        taskId: z.string().describe("The ID of the task to demote")
      },
      outputSchema: {
        result: z.string()
      }
    },
    async ({ taskId }) => {
      try {
        const { stdout, stderr } = await execAsync(`backlog tasks demote ${taskId}`, { cwd: BACKLOG_PROJECT_PATH });
        if (stderr) console.error(`stderr: ${stderr}`);

        return {
          content: [{ type: "text", text: stdout || "Task demoted successfully" }],
          structuredContent: { result: stdout }
        };
      } catch (error: any) {
        return {
          content: [{ type: "text", text: `Error: ${error.message}` }],
          structuredContent: { result: "" },
          isError: true
        };
      }
    }
  );

  // Tool: Listar Documentos
  server.registerTool(
    "list-docs",
    {
      title: "List Documents",
      description: "List all documents from backlog",
      inputSchema: {},
      outputSchema: {
        docs: z.string()
      }
    },
    async () => {
      try {
        const { stdout, stderr } = await execAsync("backlog doc list --plain", { cwd: BACKLOG_PROJECT_PATH });
        if (stderr) console.error(`stderr: ${stderr}`);

        return {
          content: [{ type: "text", text: stdout || "No documents found" }],
          structuredContent: { docs: stdout }
        };
      } catch (error: any) {
        return {
          content: [{ type: "text", text: `Error: ${error.message}` }],
          structuredContent: { docs: "" },
          isError: true
        };
      }
    }
  );

  // Tool: Ver Documento
  server.registerTool(
    "view-doc",
    {
      title: "View Document",
      description: "View a specific document",
      inputSchema: {
        docId: z.string().describe("The ID of the document to view (e.g., 'doc-1')")
      },
      outputSchema: {
        content: z.string()
      }
    },
    async ({ docId }) => {
      try {
        const docsDir = join(BACKLOG_PROJECT_PATH, 'backlog', 'docs');

        if (!existsSync(docsDir)) {
          return {
            content: [{ type: "text", text: `Docs directory not found` }],
            structuredContent: { content: "" },
            isError: true
          };
        }

        const files = readdirSync(docsDir);
        const docFile = files.find(f => f.startsWith(`${docId} - `) || f === `${docId}.md`);

        if (!docFile) {
          return {
            content: [{ type: "text", text: `Document not found: ${docId}` }],
            structuredContent: { content: "" },
            isError: true
          };
        }

        const docPath = join(docsDir, docFile);
        const content = readFileSync(docPath, 'utf-8');

        return {
          content: [{ type: "text", text: content }],
          structuredContent: { content }
        };
      } catch (error: any) {
        return {
          content: [{ type: "text", text: `Error: ${error.message}` }],
          structuredContent: { content: "" },
          isError: true
        };
      }
    }
  );

  // Tool: Criar Documento
  server.registerTool(
    "create-doc",
    {
      title: "Create Document",
      description: "Create a new document in the backlog",
      inputSchema: {
        title: z.string().describe("The title of the document")
      },
      outputSchema: {
        result: z.string()
      }
    },
    async ({ title }) => {
      try {
        const { stdout, stderr } = await execAsync(`backlog doc create "${title}"`, { cwd: BACKLOG_PROJECT_PATH });
        if (stderr) console.error(`stderr: ${stderr}`);

        return {
          content: [{ type: "text", text: stdout || "Document created successfully" }],
          structuredContent: { result: stdout }
        };
      } catch (error: any) {
        return {
          content: [{ type: "text", text: `Error: ${error.message}` }],
          structuredContent: { result: "" },
          isError: true
        };
      }
    }
  );

  return server;
}

// ============= Sessões MCP (uma instância de servidor por sessão) =============
const mcpSessions = new Map<string, {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
}>();

// POST /sse
app.post("/sse", async (req, res) => {
  // Forçar Accept header SEMPRE antes de qualquer processamento
  req.headers.accept = 'application/json, text/event-stream';

  console.log(`📨 POST /sse: ${req.body.method}`);

  try {
    const existingSessionId = req.headers["mcp-session-id"] as string;

    if (existingSessionId && mcpSessions.has(existingSessionId)) {
      console.log(`♻️  Reutilizando sessão: ${existingSessionId}`);
      const session = mcpSessions.get(existingSessionId)!;
      res.setHeader("Mcp-Session-Id", existingSessionId);
      await session.transport.handleRequest(req, res, req.body);
      return;
    }

    if (req.body.method === "initialize") {
      console.log(`🆕 Criando nova sessão`);
      const sessionId = randomUUID();

      // Criar servidor MCP exclusivo para esta sessão
      const server = createMcpServer();

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => sessionId
      });

      mcpSessions.set(sessionId, { server, transport });
      console.log(`✅ Sessão criada: ${sessionId}`);

      transport.onclose = async () => {
        mcpSessions.delete(sessionId);
        console.log(`🔴 Sessão fechada: ${sessionId}`);
      };

      await server.connect(transport);
      res.setHeader("Mcp-Session-Id", sessionId);
      await transport.handleRequest(req, res, req.body);
      return;
    }

    console.log(`❌ POST sem session ID válido e não é initialize`);
    res.status(400).json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Bad Request: Session ID required for non-initialize requests"
      },
      id: req.body?.id || null
    });

  } catch (error: any) {
    console.error("❌ Erro POST /sse:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: error?.message || "Internal server error"
        },
        id: req.body?.id || null
      });
    }
  }
});

// GET /sse
app.get("/sse", async (req, res) => {
  // Forçar Accept header SEMPRE antes de qualquer processamento
  req.headers.accept = 'application/json, text/event-stream';

  console.log(`📨 GET /sse`);

  try {
    const sessionId = req.headers["mcp-session-id"] as string;

    if (!sessionId || !mcpSessions.has(sessionId)) {
      console.log(`❌ Sessão não encontrada para GET`);
      return res.status(400).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Bad Request: No valid session ID provided"
        },
        id: null
      });
    }

    console.log(`📡 Stream SSE para sessão: ${sessionId}`);
    const session = mcpSessions.get(sessionId)!;
    await session.transport.handleRequest(req, res);

  } catch (error: any) {
    console.error("❌ Erro GET /sse:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: error?.message || "Internal server error"
        },
        id: null
      });
    }
  }
});

// DELETE /sse
app.delete("/sse", async (req, res) => {
  // Forçar Accept header SEMPRE antes de qualquer processamento
  req.headers.accept = 'application/json, text/event-stream';

  console.log(`🗑️ DELETE /sse`);

  try {
    const sessionId = req.headers["mcp-session-id"] as string;
    const session = mcpSessions.get(sessionId);

    if (!session) {
      return res.status(400).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Session not found"
        },
        id: null
      });
    }

    await session.transport.handleRequest(req, res, req.body);
  } catch (error: any) {
    console.error("❌ Erro DELETE:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: error?.message || "Internal server error"
        },
        id: null
      });
    }
  }
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    backlogPath: BACKLOG_PROJECT_PATH,
    sessions: mcpSessions.size,
    tools: 9
  });
});

// ============= Cleanup =============
process.on("SIGINT", async () => {
  console.log("\n🛑 Encerrando servidor...");
  mcpSessions.clear();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\n🛑 Encerrando servidor...");
  mcpSessions.clear();
  process.exit(0);
});

// ============= Start =============
const PORT = process.env.PORT || 8081;
app.listen(PORT, () => {
  console.log(`\n🚀 Servidor MCP rodando em ${BASE_URL}\n`);
  console.log(`📁 Projeto backlog: ${BACKLOG_PROJECT_PATH}`);
  console.log(`📋 Endpoints:`);
  console.log(`   - Root: ${BASE_URL}/`);
  console.log(`   - MCP: ${BASE_URL}/sse`);
  console.log(`   - Health: ${BASE_URL}/health`);
  console.log(`   - OAuth: ${BASE_URL}/.well-known/oauth-authorization-server\n`);

  console.log(`🔧 Tools disponíveis:`);
  console.log(`   Tasks:`);
  console.log(`     - list-tasks`);
  console.log(`     - view-task`);
  console.log(`     - create-task`);
  console.log(`     - edit-task`);
  console.log(`     - archive-task`);
  console.log(`     - demote-task`);
  console.log(`   Docs:`);
  console.log(`     - list-docs`);
  console.log(`     - view-doc`);
  console.log(`     - create-doc\n`);

  const backlogDir = join(BACKLOG_PROJECT_PATH, 'backlog');

  if (!existsSync(backlogDir)) {
    console.warn(`⚠️  AVISO: Diretório 'backlog' não encontrado em ${BACKLOG_PROJECT_PATH}`);
    console.warn(`   Execute: cd ${BACKLOG_PROJECT_PATH} && backlog init "Nome do Projeto"\n`);
  } else {
    console.log(`✅ Diretório backlog encontrado!\n`);
  }

  console.log(`🔍 Para testar no MCP Inspector:`);
  console.log(`   Transport Type: Streamable HTTP`);
  console.log(`   URL: http://localhost:${PORT}/sse`);
  console.log(`   Connection Type: Direct\n`);
});
