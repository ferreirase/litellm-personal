import { escapeXml } from "../../../formatters/xml-utils.ts";
import { BacklogToolError } from "../../errors/mcp-errors.ts";
import type { McpServer } from "../../server.ts";
import type { CallToolResult } from "../../types.ts";

export type DefinitionOfDoneDefaultsUpsertArgs = {
	items: string[];
};

function normalizeDefinitionOfDoneDefaults(items: string[]): string[] {
	return items.map((item) => item.trim()).filter((item) => item.length > 0);
}

function findDelimiterSensitiveItem(items: string[]): string | undefined {
	return items.find((item) => item.includes(","));
}

function formatDefinitionOfDoneDefaultsXml(items: string[]): string {
	if (items.length === 0) {
		return "<definition_of_done_defaults />";
	}

	const xmlItems = items.map((item, i) => `  <item index="${i + 1}">${escapeXml(item)}</item>`).join("\n");
	return `<definition_of_done_defaults>\n${xmlItems}\n</definition_of_done_defaults>`;
}

export class DefinitionOfDoneHandlers {
	constructor(private readonly core: McpServer) {}

	private async loadConfigOrThrow() {
		const config = await this.core.filesystem.loadConfig();
		if (!config) {
			throw new BacklogToolError("Backlog config not found. Initialize Backlog.md first.", "NOT_FOUND");
		}
		return config;
	}

	async getDefaults(): Promise<CallToolResult> {
		const config = await this.loadConfigOrThrow();
		const defaults = Array.isArray(config.definitionOfDone)
			? normalizeDefinitionOfDoneDefaults(config.definitionOfDone)
			: [];

		return {
			content: [
				{
					type: "text",
					text: formatDefinitionOfDoneDefaultsXml(defaults),
				},
			],
		};
	}

	async upsertDefaults(args: DefinitionOfDoneDefaultsUpsertArgs): Promise<CallToolResult> {
		const config = await this.loadConfigOrThrow();
		const nextDefaults = normalizeDefinitionOfDoneDefaults(args.items);
		const commaSensitiveItem = findDelimiterSensitiveItem(nextDefaults);
		if (commaSensitiveItem) {
			throw new BacklogToolError(
				`Definition of Done defaults cannot contain commas (invalid item: "${commaSensitiveItem}").`,
				"VALIDATION_ERROR",
			);
		}

		await this.core.filesystem.saveConfig({
			...config,
			definitionOfDone: nextDefaults,
		});

		return {
			content: [
				{
					type: "text",
					text: `Updated project Definition of Done defaults.\n\n${formatDefinitionOfDoneDefaultsXml(nextDefaults)}`,
				},
			],
		};
	}
}
