
const HOST_ROOT = process.env.HOST_ROOT || "/home/ferreirase/Documents";
const CONTAINER_DATA = "/data";
const DEFAULT_PROJECT_PATH = process.env.DEFAULT_PROJECT_PATH || HOST_ROOT;

class SessionManager {
  private paths = new Map<string, string>();

  /**
   * Resolves a host path to its equivalent inside the container volume.
   */
  resolveToContainer(path: string): string {
    if (path.startsWith(HOST_ROOT)) {
      return path.replace(HOST_ROOT, CONTAINER_DATA);
    }
    return path;
  }

  /**
   * Gets the sticky path for a session, updating it if a new path is provided.
   */
  getEffectivePath(sessionId: string, providedPath?: string): string {
    if (providedPath) {
      this.paths.set(sessionId, providedPath);
    }
    const path = this.paths.get(sessionId) || DEFAULT_PROJECT_PATH;
    return this.resolveToContainer(path);
  }

  /**
   * Extracts the session ID from the Mastra/MCP context.
   */
  getSessionId(context: any): string {
    return (context?.mcp?.extra as any)?.sessionId || "default";
  }
}

export const sessionManager = new SessionManager();
