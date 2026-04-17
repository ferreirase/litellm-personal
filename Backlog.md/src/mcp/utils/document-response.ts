import { formatDocumentXml } from "../../formatters/document-xml.ts";
import type { Document } from "../../types/index.ts";
import type { CallToolResult } from "../types.ts";

export async function formatDocumentCallResult(
	document: Document,
	options: { summaryLines?: string[] } = {},
): Promise<CallToolResult> {
	const summary = options.summaryLines?.filter((line) => line.trim().length > 0).join("\n");
	const documentText = formatDocumentXml(document);
	const text = summary ? `${summary}\n\n${documentText}` : documentText;

	return {
		content: [
			{
				type: "text",
				text,
			},
		],
	};
}
