# Deploy Fix - package-lock.json Issue

## Problema Identificado

O build no Dokploy falhou com o erro:
```
npm error The `npm ci` command can only install with an existing package-lock.json
```

## Causa Raiz

O `package-lock.json` estava sendo excluído por:
1. `.gitignore` - linha 3
2. `.dockerignore` - linha 5

Mas o `Dockerfile` usa `npm ci` que **requer** esse arquivo para builds reproduzíveis.

## Correção Aplicada

### 1. Atualizado `.gitignore`
Removida a linha que excluía `package-lock.json`:
```diff
# Dependencies
node_modules/
- package-lock.json
yarn.lock
pnpm-lock.yaml
```

### 2. Atualizado `.dockerignore`
Removida a linha que excluía `package-lock.json`:
```diff
- package-lock.json
+ # Keep package-lock.json for npm ci
```

### 3. Arquivo `package-lock.json`
O arquivo já existe no projeto (296 KB) e será versionado no Git.

## Como Fazer o Deploy Corrigido

### Passo 1: Adicionar arquivos ao Git

```bash
# Adicionar package-lock.json e .gitignore atualizado
git add package-lock.json .gitignore .dockerignore

# Verificar o que será commitado
git status
```

### Passo 2: Fazer commit

```bash
git commit -m "fix: include package-lock.json for Docker builds

- Remove package-lock.json from .gitignore
- Remove package-lock.json from .dockerignore
- Required for npm ci in Dockerfile

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

### Passo 3: Push para o repositório

```bash
git push origin main
```

### Passo 4: Re-deploy no Dokploy

Após o push, faça um novo deploy no Dokploy. O build agora deve funcionar corretamente.

## Por Que `npm ci` ao Invés de `npm install`?

O `npm ci` é recomendado para ambientes de produção porque:

✅ **Builds Reproduzíveis**: Usa exatamente as versões do `package-lock.json`
✅ **Mais Rápido**: Otimizado para CI/CD
✅ **Mais Seguro**: Falha se houver inconsistências
✅ **Limpo**: Remove `node_modules` antes de instalar

## Verificação Pós-Deploy

Após o deploy, verifique:

```bash
# 1. Health check
curl http://seu-dominio:8081/health

# 2. Logs do container
docker logs <container-id>

# 3. Teste MCP initialize
curl -X POST http://seu-dominio:8081/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "initialize",
    "params": {
      "protocolVersion": "2025-06-18",
      "capabilities": {},
      "clientInfo": {"name": "test", "version": "1.0.0"}
    },
    "id": 1
  }'
```

## Status

- ✅ Correção aplicada
- ⏳ Aguardando commit e push
- ⏳ Aguardando re-deploy

## Próximos Passos

1. Execute os comandos Git acima
2. Faça push para o repositório
3. Triggere um novo deploy no Dokploy
4. Verifique os logs de build (deve passar agora)
5. Teste o endpoint após o deploy

---

**Data da Correção**: 2026-02-17
**Tipo**: Bug fix - Build configuration
