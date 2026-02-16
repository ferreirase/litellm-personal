# Backlog MCP - Resolução Completa dos Problemas

## Histórico de Problemas e Soluções

### Problema 1: "Already connected to a transport" (Commit 6e3661c - INCORRETO)

**O que aconteceu:**
- Tentei "otimizar" criando um MCPServer compartilhado por todas as sessões
- Resultado: Erro quando LiteLLM fazia requisições paralelas
- MCP SDK permite apenas UMA transport por servidor

**Erro:**
```
❌ [backlog] Error: Already connected to a transport
```

**Solução (Commit 9792e59):**
- REVERTIDO para arquitetura original
- Criar MCPServer POR SESSÃO, não compartilhado
- As tools em cache já compartilham o StdioBridge (um stdio process)
- Cada MCPServer tem sua própria transport

### Problema 2: Validação LiteLLM - inputSchema Missing (REAL CAUSA)

**O que aconteceu:**
- Após reverter para per-session servers, LiteLLM ainda falhava
- Erro de validação Pydantic: "Field required [type=missing]"
- LiteLLM esperava `inputSchema` obrigatório em todas as tools

**Erro nos logs do LiteLLM:**
```
21 validation errors for ListToolsResult
tools.0.inputSchema
  Field required [type=missing]
tools.1.inputSchema
  Field required [type=missing]
...
```

**Root Cause:**
- **src/bridge.ts:339** - Tools criadas com `inputSchema: undefined`
- Quando MCPServer expõe via HTTP/SSE, campo era omitido
- LiteLLM validação estrita rejeita tools sem inputSchema

**Solução (Commit e21f4df):**
```typescript
// ANTES (ERRADO):
tools[tool.name] = createTool({
  id: tool.name,
  description: tool.description,
  inputSchema: undefined, // ← BUG
  execute: async (input, context) => { ... }
});

// DEPOIS (CORRETO):
tools[tool.name] = createTool({
  id: tool.name,
  description: tool.description,
  inputSchema: tool.inputSchema, // ← FIX: passa schema do MCP remoto
  execute: async (input, context) => { ... }
});
```

### Problema 3: Nome do Container Inconsistente

**O que aconteceu:**
- Docker Compose usa nome do diretório como prefixo
- Container mudava de `personal-teste-pb6zfc-gateway-mcp-1` para `stdio2sse-gateway-mcp-1`
- LiteLLM não conseguia conectar porque URL estava errada

**Solução (Commit e21f4df):**
```yaml
# docker-compose.yml
gateway-mcp:
  container_name: personal-teste-pb6zfc-gateway-mcp-1  # ← Nome fixo
  build:
    context: .
```

## Arquitetura Correta Final

### Como Funciona o Compartilhamento de Stdio Process

```
┌─────────────────────────────────────────────────────────┐
│ STARTUP (loadTools)                                     │
├─────────────────────────────────────────────────────────┤
│ bridges['backlog'] = new StdioBridge(...)               │
│   ↓                                                     │
│ bridges['backlog'].start()                              │
│   ↓                                                     │
│ spawns: "backlog mcp start" (PID 85)  ← UM PROCESSO    │
│   ↓                                                     │
│ toolCaches['backlog'] = bridge.getMastraTools()         │
│   ↓                                                     │
│ Cria 21 tools, cada uma com:                           │
│   execute: (input, context) => {                        │
│     return this.request('tools/call', ...)              │
│     // "this" = bridge compartilhado!                   │
│   }                                                     │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ PER SESSION (createSegmentRoute)                        │
├─────────────────────────────────────────────────────────┤
│ Session 1:                                              │
│   server1 = new MCPServer({                             │
│     tools: toolCaches['backlog']  ← CACHE              │
│   })                                                    │
│   transport1 = new Transport()                          │
│   server1.connect(transport1) ✓                         │
│                                                         │
│ Session 2:                                              │
│   server2 = new MCPServer({                             │
│     tools: toolCaches['backlog']  ← MESMO CACHE        │
│   })                                                    │
│   transport2 = new Transport()                          │
│   server2.connect(transport2) ✓                         │
│                                                         │
│ Ambos usam:                                             │
│   → Mesmas tools (cache)                               │
│   → Mesmo StdioBridge (via closure)                    │
│   → Mesmo stdio process (PID 85)                       │
│   → Mas cada um tem transport separado ✓               │
└─────────────────────────────────────────────────────────┘
```

### Por Que inputSchema É Importante

O LiteLLM usa validação Pydantic estrita no protocolo MCP. Quando faz `tools/list`:

1. **Gateway-MCP retorna:**
   ```json
   {
     "result": {
       "tools": [
         {
           "name": "task_create",
           "description": "Create a new task",
           "inputSchema": {
             "type": "object",
             "properties": {
               "title": {"type": "string"}
             }
           }
         }
       ]
     }
   }
   ```

2. **LiteLLM valida com Pydantic:**
   ```python
   class Tool(BaseModel):
       name: str
       description: str
       inputSchema: dict  # ← Campo obrigatório!
   ```

3. **Sem inputSchema → Validation Error**

## Fluxo de Teste Completo

### 1. Teste Direto do Gateway
```bash
curl -X POST http://localhost:8081/backlog/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {"protocolVersion": "2024-11-05", "capabilities": {}}
  }'
```

**Resultado esperado:**
```
event: message
data: {"result":{"protocolVersion":"2024-11-05",...},"jsonrpc":"2.0","id":1}
```

### 2. Teste de Health Check
```bash
curl http://localhost:8081/health | jq '.segments.backlog'
```

**Resultado esperado:**
```json
{
  "enabled": true,
  "activeSessions": 0,
  "tools": 21,
  "url": "/backlog/mcp"
}
```

### 3. Verificar Logs do LiteLLM
```bash
docker logs personal-litellm-ukykiw-litellm-1 --tail 100 | grep -i "backlog\|validation"
```

**Resultado esperado:** Sem erros de validação

### 4. Teste via LiteLLM
No Claude Code CLI ou outra interface que use LiteLLM, tente usar uma tool do backlog:
```
list my backlog tasks
```

**Resultado esperado:** Lista de tasks retornada com sucesso

## Commits do Fix

1. **6e3661c** - ❌ INCORRETO: Tentou compartilhar um MCPServer
2. **9792e59** - ✅ Reverteu para per-session MCPServer
3. **e21f4df** - ✅ FINAL: Adicionou inputSchema às tools

## Verificação Final

✅ **Gateway funcionando:**
- `curl http://localhost:8081/health` retorna 21 tools para backlog
- Endpoint `/backlog/mcp` responde a requisições

✅ **LiteLLM sem erros:**
- Logs não mostram mais "21 validation errors"
- Logs não mostram "inputSchema Field required"

✅ **Arquitetura correta:**
- Um StdioBridge por segmento (um stdio process)
- Um MCPServer por sessão HTTP (múltiplas sessions)
- Tools com inputSchema válido para LiteLLM

✅ **Nome do container fixo:**
- `personal-teste-pb6zfc-gateway-mcp-1` sempre
- LiteLLM pode conectar de forma consistente

## Próximos Passos

1. **Testar no Claude Code CLI** através do LiteLLM
2. **Verificar que todas as 21 tools do backlog funcionam**
3. **Monitorar logs** para garantir estabilidade
4. **Considerar adicionar testes automatizados** para prevenir regressões

## Lições Aprendidas

1. **Não otimize prematuramente** - A arquitetura original estava correta
2. **Entenda a pilha completa** - O problema não estava onde eu pensava inicialmente
3. **Validação estrita importa** - LiteLLM requer conformidade estrita com MCP spec
4. **Leia os logs cuidadosamente** - A mensagem de erro do LiteLLM apontava o problema real
5. **JSON Schema é obrigatório** - Mesmo que pareça opcional, é necessário para clientes estritos

## Contato

Se houver problemas:
1. Verifique logs: `docker logs personal-teste-pb6zfc-gateway-mcp-1`
2. Verifique health: `curl http://localhost:8081/health`
3. Verifique LiteLLM: `docker logs personal-litellm-ukykiw-litellm-1`
4. Reinicie se necessário: `docker restart personal-teste-pb6zfc-gateway-mcp-1 personal-litellm-ukykiw-litellm-1`
