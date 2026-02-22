# Fix MCP Auth Display + Stability + Remove desktop-commander

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Corrigir o header de auth para `Authorization: Bearer` (padrão LiteLLM), remover desktop-commander, e estabilizar o session cleanup quando processos filhos morrem inesperadamente.

**Architecture:** Três mudanças independentes: (1) header fix no sync-mcp.js que gera o .claude.json; (2) remoção do desktop-commander do registry e da rota legada em server-simple.ts, com fix no error handler para session cleanup imediato; (3) remoção de permissão legada em settings.local.json. Finaliza com rebuild do container e regeneração do .claude.json.

**Tech Stack:** Node.js/TypeScript, Express, Docker Compose, child_process.spawn

**Contexto importante:**
- `user: "1000:1000"` já está descomentado no docker-compose.yml (linha 51) ✓
- `uid`/`gid` já estão em ambos os `spawn()` em server-simple.ts (linhas 180-181, 358-359) ✓
- sync-mcp.js pula entradas existentes no .claude.json — o fix remove essa lógica de skip

---

### Task 1: Fix proc.on("error") no server-simple.ts para cleanup imediato

**Problema:** Quando um processo filho tem um erro (ex: stdin fecha antes do exit), a sessão permanece no Map até o evento `exit`. Requests que chegam nessa janela encontram a sessão morta e falham com write error, causando o comportamento flaky.

**Files:**
- Modify: `src/server-simple.ts:230-232`

**Step 1: Editar o handler de error para fazer cleanup imediato**

Localizar o bloco atual (linha ~230):
```typescript
proc.on("error", (error: Error) => {
  logger.error(`[${serverName}:${sessionId}] process error:`, error);
});
```

Substituir por:
```typescript
proc.on("error", (error: Error) => {
  logger.error(`[${serverName}:${sessionId}] process error:`, error);
  sessions.delete(sessionKey(serverName, sessionId));
  for (const [, { reject }] of session.pendingRequests) {
    reject(new Error(`subprocess error: ${error.message}`));
  }
  session.pendingRequests.clear();
});
```

**Step 2: Verificar que o exit handler não tenta deletar novamente com erro**

O exit handler (linha ~234) já tem `sessions.delete(...)` — isso é seguro porque `Map.delete` em chave inexistente é no-op.

**Step 3: Commit**

```bash
git add src/server-simple.ts
git commit -m "fix: cleanup session immediately on subprocess error"
```

---

### Task 2: Remover desktop-commander do server-simple.ts

**Files:**
- Modify: `src/server-simple.ts:37-41` (entry no MCP_SERVERS)
- Modify: `src/server-simple.ts:663-665` (rota backward-compat `/mcp`)

**Step 1: Remover entry desktop-commander do registry**

Localizar e remover bloco (linhas 37-41):
```typescript
"desktop-commander": {
  command: "npx",
  args: ["@wonderwhy-er/desktop-commander@latest"],
  extraEnv: { WORKSPACE_PATH, LOG_LEVEL },
},
```

**Step 2: Atualizar rota /mcp backward-compat**

Localizar (linhas 663-665):
```typescript
// Backward-compat: /mcp → desktop-commander
app.all("/mcp", async (req, res) => {
  await handleMcpRequest("desktop-commander", req, res);
});
```

Substituir por:
```typescript
// /mcp sem server path → listar servidores disponíveis
app.all("/mcp", (_req, res) => {
  res.status(400).json({
    error: "Server path required. Use /mcp/:server",
    available: Object.keys(MCP_SERVERS),
  });
});
```

**Step 3: Commit**

```bash
git add src/server-simple.ts
git commit -m "feat: remove desktop-commander from MCP registry and fix /mcp fallback route"
```

---

### Task 3: Remover desktop-commander de settings.local.json

**Files:**
- Modify: `.claude/settings.local.json`

**Step 1: Remover a permissão legada**

```json
{
  "permissions": {
    "allow": [
      "WebFetch(domain:github.com)",
      "WebFetch(domain:raw.githubusercontent.com)",
      "WebSearch",
      "mcp__backlog__task_list"
    ]
  }
}
```

**Step 2: Commit**

```bash
git add .claude/settings.local.json
git commit -m "chore: remove desktop-commander permission from settings.local.json"
```

---

### Task 4: Fix auth header em sync-mcp.js

**Problema:** sync-mcp.js gera entradas no .claude.json com `x-litellm-api-key: Bearer <token>` (header não-padrão). LiteLLM aceita e Claude Code reconhece `Authorization: Bearer <token>`. Além disso, sync-mcp.js pula entradas existentes — precisa sempre atualizar os headers.

**Files:**
- Modify: `~/.claude/sync-mcp.js:88` (header name)
- Modify: `~/.claude/sync-mcp.js:76-85` (remover skip de entradas existentes)

**Step 1: Trocar o header de auth**

Localizar linha 88:
```js
"x-litellm-api-key": `Bearer ${LITELLM_API_KEY}`,
```

Substituir por:
```js
"Authorization": `Bearer ${LITELLM_API_KEY}`,
```

**Step 2: Remover o skip de entradas já existentes**

Localizar bloco (linhas 76-85):
```js
if (exists && needsProjectPath) {
  config.mcpServers[server.alias].headers ??= {};
  config.mcpServers[server.alias].headers["x-project-path"] = PROJECT_PATH;
  console.log(
    `[sync-mcp] x-project-path → ${server.alias}: ${PROJECT_PATH}`,
  );
  continue;
}

if (exists) continue;
```

Substituir por (sempre regenera headers):
```js
// Sempre atualiza — garante que mudanças no header format são aplicadas
```

Ou seja: remover os dois blocos `if (exists)` inteiramente, deixando o código cair direto na geração dos headers.

**Step 3: Regenerar .claude.json**

```bash
node ~/.claude/sync-mcp.js /home/ferreirase/Documents/Estudos/AI/mcp-to-server
```

Verificar que as entradas em `~/.claude.json` agora têm `"Authorization"` em vez de `"x-litellm-api-key"`.

---

### Task 5: Rebuild container e verificação final

**Step 1: Build e restart do container**

```bash
cd /home/ferreirase/Documents/Estudos/AI/mcp-to-server
docker compose build gateway-mcp && docker compose up -d gateway-mcp
```

Aguardar healthcheck ficar healthy:
```bash
docker ps | grep gateway-mcp
# STATUS deve mostrar: Up X seconds (healthy)
```

**Step 2: Verificar auth no Claude Code**

```bash
claude mcp
```

Esperado: MCPs mostram `Auth: ✔` ou sem menção de "not authenticated"

**Step 3: Verificar remoção do desktop-commander**

```bash
claude mcp
```

`desktop-commander` não deve aparecer na lista.

**Step 4: Verificar permissões do backlog**

```bash
# Criar uma task de teste
# Verificar ownership dos arquivos criados
ls -la /home/ferreirase/Documents/Estudos/AI/mcp-to-server/backlog/tasks/
# Owner deve ser ferreirase:ferreirase (não root:root)
```

**Step 5: Verificar servidores disponíveis no gateway**

```bash
curl http://localhost:8082/mcp/servers
# Esperado: ["sequential-thinking","claude-context","backlog","mastra-memory","serena"]
# desktop-commander NÃO deve aparecer
```

**Step 6: Verificar health**

```bash
curl http://localhost:8082/health
# servers não deve incluir desktop-commander
```
