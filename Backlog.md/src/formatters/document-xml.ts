import type { Document } from "../types/index.ts";
import { escapeXml } from "./xml-utils.ts";

export function formatDocumentXml(document: Document): string {
	const lines: string[] = [];

	lines.push("<document>");
	lines.push(`  <id>${escapeXml(document.id)}</id>`);
	lines.push(`  <title>${escapeXml(document.title)}</title>`);
	lines.push(`  <type>${escapeXml(document.type)}</type>`);
	lines.push(`  <created_date>${escapeXml(document.createdDate)}</created_date>`);

	if (document.updatedDate) {
		lines.push(`  <updated_date>${escapeXml(document.updatedDate)}</updated_date>`);
	}

	if (document.tags?.length) {
		lines.push("  <tags>");
		for (const tag of document.tags) {
			lines.push(`    <tag>${escapeXml(tag)}</tag>`);
		}
		lines.push("  </tags>");
	}

	const content = document.rawContent?.trim() ?? "";
	lines.push("  <content>");
	for (const line of content.split("\n")) {
		lines.push(`    ${escapeXml(line)}`);
	}
	lines.push("  </content>");

	lines.push("</document>");

	return lines.join("\n");
}

export function formatDocumentListXml(documents: Document[], options: { query?: string } = {}): string {
	const lines: string[] = [];

	lines.push("<documents>");

	if (options.query) {
		lines.push(`  <query>${escapeXml(options.query)}</query>`);
	}

	for (const document of documents) {
		lines.push("  <document>");
		lines.push(`    <id>${escapeXml(document.id)}</id>`);
		lines.push(`    <title>${escapeXml(document.title)}</title>`);
		lines.push(`    <type>${escapeXml(document.type)}</type>`);
		lines.push("  </document>");
	}

	lines.push("</documents>");

	return lines.join("\n");
}
