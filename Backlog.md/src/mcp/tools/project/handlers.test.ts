import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMcpServer, type McpServer } from "../../server.ts";

// Helper to extract text from MCP content entries (handles union types).
const getText = (content: unknown[] | undefined, index = 0): string => {
	const item = content?.[index] as { text?: string } | undefined;
	return item?.text ?? "";
};

// In fallback mode the server gates all requests behind a readiness promise
// that resolves from `oninitialized`. Tests never connect a real transport,
// so we simulate client init to unblock the handlers (mirrors the pattern in
// src/test/mcp-fallback.test.ts).
//
// We also stub the list-changed notifications because the underlying MCP SDK
// throws "Not connected" when no transport is attached. Those notifications
// are fire-and-forget signals to the client and are irrelevant to the
// behavior under test.
const unblockServer = (server: McpServer) => {
	const inner = server.getServer() as unknown as {
		oninitialized?: () => void;
		sendToolListChanged: () => Promise<void>;
		sendResourceListChanged: () => Promise<void>;
		sendPromptListChanged: () => Promise<void>;
		sendLoggingMessage: (msg: unknown) => Promise<void>;
	};
	inner.sendToolListChanged = async () => {};
	inner.sendResourceListChanged = async () => {};
	inner.sendPromptListChanged = async () => {};
	inner.sendLoggingMessage = async () => {};
	inner.oninitialized?.();
};

// Helper to normalize a CallToolResult regardless of whether the handler
// threw a BacklogToolError (converted to { isError: true }) or returned a
// non-error result.
const callInit = async (server: McpServer, args: Record<string, unknown>) => {
	return server.testInterface.callTool({
		params: { name: "project_init", arguments: args },
	});
};

describe("MCP project_init tool", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "mcp-project-init-test-"));
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	test("happy path: initializes project structure and writes config.yml", async () => {
		const server = await createMcpServer(tempDir, { debug: false });
		unblockServer(server);

		const result = await callInit(server, { projectName: "test-proj" });

		// Success result shape.
		expect(result.isError).toBeFalsy();
		expect(getText(result.content)).toContain("Initialized Backlog.md project");
		expect(getText(result.content)).toContain("test-proj");

		// Directory structure created under default "backlog/" dir.
		const backlogDir = join(tempDir, "backlog");
		expect(existsSync(backlogDir)).toBe(true);
		expect(existsSync(join(backlogDir, "tasks"))).toBe(true);
		expect(existsSync(join(backlogDir, "drafts"))).toBe(true);
		expect(existsSync(join(backlogDir, "completed"))).toBe(true);
		expect(existsSync(join(backlogDir, "archive", "tasks"))).toBe(true);
		expect(existsSync(join(backlogDir, "archive", "drafts"))).toBe(true);
		// config.yml should exist under the backlog directory by default.
		const configPath = join(backlogDir, "config.yml");
		expect(existsSync(configPath)).toBe(true);

		// config.yml should reference the project name and default statuses.
		const configText = await Bun.file(configPath).text();
		expect(configText).toContain("project_name");
		expect(configText).toContain("test-proj");
		expect(configText).toContain("To Do");
		expect(configText).toContain("In Progress");
		expect(configText).toContain("Done");
	});

	test("supports custom taskPrefix via advancedConfig", async () => {
		const server = await createMcpServer(tempDir, { debug: false });
		unblockServer(server);

		const result = await callInit(server, {
			projectName: "prefix-proj",
			taskPrefix: "ISSUE",
		});

		expect(result.isError).toBeFalsy();

		// Verify the persisted prefix via Core rather than parsing YAML by hand.
		const config = await server.filesystem.loadConfig();
		expect(config).not.toBeNull();
		expect(config?.prefixes?.task).toBe("ISSUE");
	});

	test("supports a custom backlogDirectory", async () => {
		const server = await createMcpServer(tempDir, { debug: false });
		unblockServer(server);

		const result = await callInit(server, {
			projectName: "custom-dir-proj",
			backlogDirectory: "custom-backlog",
		});

		expect(result.isError).toBeFalsy();

		// Custom dir should exist with the full structure.
		const customDir = join(tempDir, "custom-backlog");
		expect(existsSync(customDir)).toBe(true);
		expect(existsSync(join(customDir, "tasks"))).toBe(true);
		expect(existsSync(join(customDir, "drafts"))).toBe(true);

		// The default "backlog/" directory must NOT exist.
		expect(existsSync(join(tempDir, "backlog"))).toBe(false);
	});

	test("rejects input missing projectName with a validation error", async () => {
		const server = await createMcpServer(tempDir, { debug: false });
		unblockServer(server);

		const result = await callInit(server, {});

		expect(result.isError).toBe(true);
		const text = getText(result.content);
		// Required-field error message from validators.ts or the formatted MCP error.
		expect(text.toLowerCase()).toContain("projectname");
	});

	test("rejects projectName longer than 200 chars", async () => {
		const server = await createMcpServer(tempDir, { debug: false });
		unblockServer(server);

		const longName = "a".repeat(201);
		const result = await callInit(server, { projectName: longName });

		expect(result.isError).toBe(true);
		const text = getText(result.content);
		// maxLength violation should surface the field name in the error.
		expect(text.toLowerCase()).toContain("projectname");

		// Structure must not have been created on validation failure.
		expect(existsSync(join(tempDir, "backlog"))).toBe(false);
	});

	test("rejects invalid configLocation enum value", async () => {
		const server = await createMcpServer(tempDir, { debug: false });
		unblockServer(server);

		const result = await callInit(server, {
			projectName: "x",
			configLocation: "bogus",
		});

		expect(result.isError).toBe(true);
		const text = getText(result.content);
		expect(text.toLowerCase()).toContain("configlocation");

		// Structure must not have been created on validation failure.
		expect(existsSync(join(tempDir, "backlog"))).toBe(false);
	});

	test("returns an error when called on an already-initialized project", async () => {
		const server = await createMcpServer(tempDir, { debug: false });
		unblockServer(server);

		const first = await callInit(server, { projectName: "already" });
		expect(first.isError).toBeFalsy();

		const second = await callInit(server, { projectName: "already" });
		expect(second.isError).toBe(true);
		expect(getText(second.content).toLowerCase()).toContain("already initialized");
	});

	test("server tool list upgrades from fallback to full toolset after successful init", async () => {
		const server = await createMcpServer(tempDir, { debug: false });
		unblockServer(server);

		// Before init: fallback mode exposes only project_init (no task tools).
		const before = await server.testInterface.listTools();
		const beforeNames = before.tools.map((t) => t.name);
		expect(beforeNames).toContain("project_init");
		expect(beforeNames).not.toContain("task_create");
		expect(beforeNames).not.toContain("task_list");

		const result = await callInit(server, { projectName: "upgrade-proj" });
		expect(result.isError).toBeFalsy();

		// After init: full toolset should be registered (task_* et al).
		const after = await server.testInterface.listTools();
		const afterNames = after.tools.map((t) => t.name);
		expect(afterNames).toContain("task_create");
		expect(afterNames).toContain("task_list");
		// project_init remains registered in normal mode as well.
		expect(afterNames).toContain("project_init");
	});
});
