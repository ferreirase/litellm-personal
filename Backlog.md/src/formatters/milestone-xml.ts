import type { Milestone } from "../types/index.ts";
import { escapeXml } from "./xml-utils.ts";

export function formatMilestoneListXml(active: Milestone[], unconfigured: string[], archivedOnTasks: string[]): string {
	const lines: string[] = [];

	lines.push("<milestones>");

	lines.push("  <active>");
	for (const milestone of active) {
		lines.push("    <milestone>");
		lines.push(`      <id>${escapeXml(milestone.id)}</id>`);
		lines.push(`      <title>${escapeXml(milestone.title)}</title>`);
		const description = milestone.description?.trim();
		if (description) {
			lines.push("      <description>");
			for (const line of description.split("\n")) {
				lines.push(`        ${escapeXml(line)}`);
			}
			lines.push("      </description>");
		}
		lines.push("    </milestone>");
	}
	lines.push("  </active>");

	if (unconfigured.length > 0) {
		lines.push("  <unconfigured>");
		for (const value of unconfigured) {
			lines.push(`    <milestone>${escapeXml(value)}</milestone>`);
		}
		lines.push("  </unconfigured>");
	}

	if (archivedOnTasks.length > 0) {
		lines.push("  <archived_on_tasks>");
		for (const value of archivedOnTasks) {
			lines.push(`    <milestone>${escapeXml(value)}</milestone>`);
		}
		lines.push("  </archived_on_tasks>");
	}

	lines.push("</milestones>");

	return lines.join("\n");
}
