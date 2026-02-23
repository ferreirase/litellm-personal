import type { Document } from "../types/index.ts";
import { cdata, escapeXml } from "./xml-utils.ts";

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
	lines.push(`  <content>${cdata(content)}</content>`);

	lines.push("</document>");

	return lines.join("\n");
}

export function formatDocumentListXml(documents: Document[], options: { query?: string } = {}): string {
	const lines: string[] = [];

	const openTag = options.query ? `<documents query="${escapeXml(options.query)}">` : "<documents>";
	lines.push(openTag);

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
