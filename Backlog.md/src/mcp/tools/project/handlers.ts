import { initializeProject } from "../../../core/init.ts";
import { BacklogToolError } from "../../errors/mcp-errors.ts";
import type { McpServer } from "../../server.ts";
import type { CallToolResult } from "../../types.ts";

export type ProjectInitArgs = {
	projectName: string;
	backlogDirectory?: string;
	configLocation?: "folder" | "root";
	taskPrefix?: string;
};

export class ProjectHandlers {
	constructor(private readonly server: McpServer) {}

	async initProject(args: ProjectInitArgs): Promise<CallToolResult> {
		await this.server.ensureConfigLoaded();
		const existingConfig = await this.server.filesystem.loadConfig();
		if (existingConfig) {
			throw new BacklogToolError(
				"Project already initialized. Use the Backlog.md CLI to re-initialize.",
				"ALREADY_INITIALIZED",
			);
		}

		await initializeProject(this.server, {
			projectName: args.projectName,
			backlogDirectory: args.backlogDirectory,
			configLocation: args.configLocation,
			integrationMode: "none",
			advancedConfig: {
				taskPrefix: args.taskPrefix,
			},
		});

		await this.server.refreshAfterInit();

		const projectRoot = this.server.filesystem.rootDir;
		return {
			content: [
				{
					type: "text",
					text: `Initialized Backlog.md project "${args.projectName}" at ${projectRoot}.`,
				},
			],
		};
	}
}
