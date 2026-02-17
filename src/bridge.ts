import {
  JSONRPCRequest,
  JSONRPCResponse,
  JSONRPCNotification,
  PendingRequest,
  Logger,
} from "./types.js";
import { DesktopCommanderProcess } from "./desktop-commander.js";

/**
 * Bridges HTTP JSON-RPC requests to Desktop Commander stdio
 * Manages request correlation and timeout handling
 */
export class StdioBridge {
  private process: DesktopCommanderProcess;
  private logger: Logger;
  private pendingRequests: Map<string | number, PendingRequest>;
  private defaultTimeout: number;
  private notificationHandlers: Set<
    (notification: JSONRPCNotification) => void
  >;

  constructor(
    process: DesktopCommanderProcess,
    logger: Logger,
    defaultTimeout: number = 30000,
  ) {
    this.process = process;
    this.logger = logger;
    this.pendingRequests = new Map();
    this.defaultTimeout = defaultTimeout;
    this.notificationHandlers = new Set();

    // Listen for responses from Desktop Commander
    this.process.onResponse(this.handleResponse.bind(this));

    // Listen for notifications from Desktop Commander
    this.process.onNotification(this.handleNotification.bind(this));

    // Listen for process errors
    this.process.onError(this.handleProcessError.bind(this));

    // Listen for process exit
    this.process.onExit(this.handleProcessExit.bind(this));
  }

  /**
   * Send a request to Desktop Commander and wait for response
   */
  async sendRequest(request: JSONRPCRequest): Promise<JSONRPCResponse> {
    if (!this.process.isRunning()) {
      throw new Error("Desktop Commander process is not running");
    }

    return new Promise<JSONRPCResponse>((resolve, reject) => {
      // Set up timeout
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(request.id);
        reject(new Error(`Request timeout after ${this.defaultTimeout}ms`));
      }, this.defaultTimeout);

      // Store pending request
      this.pendingRequests.set(request.id, {
        resolve,
        reject,
        timeout,
      });

      // Send request to Desktop Commander
      this.process.sendMessage(request).catch((error) => {
        clearTimeout(timeout);
        this.pendingRequests.delete(request.id);
        reject(error);
      });
    });
  }

  /**
   * Handle response from Desktop Commander
   */
  private handleResponse(response: JSONRPCResponse): void {
    const id = response.id;
    if (id === null) {
      this.logger.warn("Received response with null id", response);
      return;
    }

    const pending = this.pendingRequests.get(id);
    if (!pending) {
      this.logger.warn("Received response for unknown request id:", id);
      return;
    }

    // Clear timeout and remove from pending
    clearTimeout(pending.timeout);
    this.pendingRequests.delete(id);

    // Resolve or reject based on response
    if (response.error) {
      const error = new Error(response.error.message);
      (error as any).code = response.error.code;
      (error as any).data = response.error.data;
      pending.reject(error);
    } else {
      pending.resolve(response);
    }
  }

  /**
   * Handle notification from Desktop Commander
   */
  private handleNotification(notification: JSONRPCNotification): void {
    this.logger.debug(
      "Received notification from Desktop Commander:",
      notification,
    );

    // Propagate to all registered handlers
    for (const handler of this.notificationHandlers) {
      try {
        handler(notification);
      } catch (error) {
        this.logger.error("Error in notification handler:", error);
      }
    }
  }

  /**
   * Handle process error
   */
  private handleProcessError(error: Error): void {
    this.logger.error("Desktop Commander process error:", error);

    // Reject all pending requests
    for (const [id, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(
        new Error(`Desktop Commander process error: ${error.message}`),
      );
      this.pendingRequests.delete(id);
    }
  }

  /**
   * Handle process exit
   */
  private handleProcessExit(info: {
    code: number | null;
    signal: string | null;
  }): void {
    this.logger.warn("Desktop Commander process exited:", info);

    // Reject all pending requests
    for (const [id, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(
        new Error("Desktop Commander process exited unexpectedly"),
      );
      this.pendingRequests.delete(id);
    }
  }

  /**
   * Register a handler for notifications
   */
  onNotification(handler: (notification: JSONRPCNotification) => void): void {
    this.notificationHandlers.add(handler);
  }

  /**
   * Unregister a notification handler
   */
  offNotification(handler: (notification: JSONRPCNotification) => void): void {
    this.notificationHandlers.delete(handler);
  }

  /**
   * Get the number of pending requests
   */
  getPendingRequestCount(): number {
    return this.pendingRequests.size;
  }

  /**
   * Clear all pending requests (useful for cleanup)
   */
  clearPendingRequests(): void {
    for (const [id, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("Pending requests cleared"));
    }
    this.pendingRequests.clear();
  }
}
