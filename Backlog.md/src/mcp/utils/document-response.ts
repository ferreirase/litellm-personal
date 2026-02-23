import { formatDocumentXml } from "../../formatters/document-xml.ts";
import type { Document } from "../../types/index.ts";
import type { CallToolResult } from "../types.ts";

export async function formatDocumentCallResult(
	document: Document,
	summaryLines: string[] = [],
): Promise<CallToolResult> {
	const formattedDocument = formatDocumentXml(document);
	const summary = summaryLines.filter((line) => line.trim().length > 0).join("\n");
	const text = summary ? `${summary}\n\n${formattedDocument}` : formattedDocument;
	return { content: [{ type: "text", text }] };
}
