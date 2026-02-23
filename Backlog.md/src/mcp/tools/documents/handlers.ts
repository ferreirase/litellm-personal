import { formatDocumentListXml } from "../../../formatters/document-xml.ts";
import type { Document, DocumentSearchResult } from "../../../types/index.ts";
import { McpError } from "../../errors/mcp-errors.ts";
import type { McpServer } from "../../server.ts";
import type { CallToolResult } from "../../types.ts";
import { formatDocumentCallResult } from "../../utils/document-response.ts";

export type DocumentListArgs = {
	search?: string;
};

export type DocumentViewArgs = {
	id: string;
};

export type DocumentCreateArgs = {
	title: string;
	content: string;
};

export type DocumentUpdateArgs = {
	id: string;
	title?: string;
	content: string;
};

export type DocumentSearchArgs = {
	query: string;
	limit?: number;
};

export class DocumentHandlers {
	constructor(private readonly core: McpServer) {}

	private async loadDocumentOrThrow(id: string): Promise<Document> {
		const document = await this.core.getDocument(id);
		if (!document) {
			throw new McpError(`Document not found: ${id}`, "DOCUMENT_NOT_FOUND");
		}
		return document;
	}

	async listDocuments(args: DocumentListArgs = {}): Promise<CallToolResult> {
		const search = args.search?.toLowerCase();
		const documents = await this.core.filesystem.listDocuments();

		const filtered =
			search && search.length > 0
				? documents.filter((document) => {
						const haystacks = [document.id, document.title];
						return haystacks.some((value) => value.toLowerCase().includes(search));
					})
				: documents;

		return { content: [{ type: "text", text: formatDocumentListXml(filtered) }] };
	}

	async viewDocument(args: DocumentViewArgs): Promise<CallToolResult> {
		const document = await this.loadDocumentOrThrow(args.id);
		return await formatDocumentCallResult(document);
	}

	async createDocument(args: DocumentCreateArgs): Promise<CallToolResult> {
		try {
			const document = await this.core.createDocumentWithId(args.title, args.content);
			return await formatDocumentCallResult(document, ["Document created successfully."]);
		} catch (error) {
			if (error instanceof Error) {
				throw new McpError(`Failed to create document: ${error.message}`, "OPERATION_FAILED");
			}
			throw new McpError("Failed to create document.", "OPERATION_FAILED");
		}
	}

	async updateDocument(args: DocumentUpdateArgs): Promise<CallToolResult> {
		const existing = await this.loadDocumentOrThrow(args.id);
		const nextDocument = args.title ? { ...existing, title: args.title } : existing;

		try {
			await this.core.updateDocument(nextDocument, args.content);
			const refreshed = await this.core.getDocument(existing.id);
			if (!refreshed) {
				throw new McpError(`Document not found: ${args.id}`, "DOCUMENT_NOT_FOUND");
			}
			return await formatDocumentCallResult(refreshed, ["Document updated successfully."]);
		} catch (error) {
			if (error instanceof Error) {
				throw new McpError(`Failed to update document: ${error.message}`, "OPERATION_FAILED");
			}
			throw new McpError("Failed to update document.", "OPERATION_FAILED");
		}
	}

	async searchDocuments(args: DocumentSearchArgs): Promise<CallToolResult> {
		const searchService = await this.core.getSearchService();
		const results = searchService.search({
			query: args.query,
			limit: args.limit,
			types: ["document"],
		});

		const documents = results
			.filter((result): result is DocumentSearchResult => result.type === "document")
			.map((result) => result.document);

		return { content: [{ type: "text", text: formatDocumentListXml(documents, { query: args.query }) }] };
	}
}
