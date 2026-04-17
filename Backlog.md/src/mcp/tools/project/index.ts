import type { McpServer } from "../../server.ts";
import type { McpToolHandler } from "../../types.ts";
import { createSimpleValidatedTool } from "../../validation/tool-wrapper.ts";
import { ProjectHandlers, type ProjectInitArgs } from "./handlers.ts";
import { projectInitSchema } from "./schemas.ts";

export function registerProjectTools(server: McpServer): void {
	const handlers = new ProjectHandlers(server);

	const initProjectTool: McpToolHandler = createSimpleValidatedTool(
		{
			name: "project_init",
			description: "Initialize a new Backlog.md project in the current workspace",
			inputSchema: projectInitSchema,
			annotations: { title: "Initialize Project", destructiveHint: false, idempotentHint: false },
		},
		projectInitSchema,
		async (input) => handlers.initProject(input as ProjectInitArgs),
	);

	server.addTool(initProjectTool);
}
