import { describe, expect, it } from "bun:test";
import { formatDocumentListXml, formatDocumentXml } from "../formatters/document-xml.ts";
import { formatMilestoneListXml } from "../formatters/milestone-xml.ts";
import type { Document, Milestone } from "../types/index.ts";

function makeDocument(overrides: Partial<Document> = {}): Document {
	return {
		id: "doc-1",
		title: "My Document",
		type: "readme",
		createdDate: "2025-07-01",
		rawContent: "# Hello\n\nSome content.",
		...overrides,
	};
}

function makeMilestone(overrides: Partial<Milestone> = {}): Milestone {
	return {
		id: "m-0",
		title: "Release 1.0",
		description: "",
		rawContent: "",
		...overrides,
	};
}

describe("formatDocumentXml", () => {
	it("minimal document — required fields only", () => {
		const xml = formatDocumentXml(makeDocument({ updatedDate: undefined, tags: undefined }));
		expect(xml).toContain("<id>doc-1</id>");
		expect(xml).toContain("<title>My Document</title>");
		expect(xml).toContain("<type>readme</type>");
		expect(xml).toContain("<created_date>2025-07-01</created_date>");
		expect(xml).not.toContain("<updated_date>");
		expect(xml).not.toContain("<tags>");
	});

	it("includes content in CDATA block", () => {
		const xml = formatDocumentXml(makeDocument({ rawContent: "# Hello\n\nSome **markdown**." }));
		expect(xml).toContain("<content><![CDATA[# Hello\n\nSome **markdown**.]]></content>");
	});

	it("includes updated_date when present", () => {
		const xml = formatDocumentXml(makeDocument({ updatedDate: "2025-07-10" }));
		expect(xml).toContain("<updated_date>2025-07-10</updated_date>");
	});

	it("includes tags when non-empty", () => {
		const xml = formatDocumentXml(makeDocument({ tags: ["design", "api"] }));
		expect(xml).toContain("<tags>");
		expect(xml).toContain("<tag>design</tag>");
		expect(xml).toContain("<tag>api</tag>");
	});

	it("omits tags when empty array", () => {
		const xml = formatDocumentXml(makeDocument({ tags: [] }));
		expect(xml).not.toContain("<tags>");
	});

	it("escapes XML special chars in title", () => {
		const xml = formatDocumentXml(makeDocument({ title: "A & B <test>" }));
		expect(xml).toContain("<title>A &amp; B &lt;test&gt;</title>");
	});

	it("handles empty rawContent", () => {
		const xml = formatDocumentXml(makeDocument({ rawContent: "" }));
		expect(xml).toContain("<content><![CDATA[]]></content>");
	});

	it("handles undefined rawContent", () => {
		const xml = formatDocumentXml(makeDocument({ rawContent: undefined }));
		expect(xml).toContain("<content><![CDATA[]]></content>");
	});

	it("CDATA escapes ]]> in content", () => {
		const xml = formatDocumentXml(makeDocument({ rawContent: "end ]]> here" }));
		// The ]]> sequence is split as: ]]]]><![CDATA[>
		expect(xml).toContain("]]]]><![CDATA[>");
		// Final closing ]]> must only appear at the end of the CDATA block
		expect(xml).toContain("<content><![CDATA[end ]]]]><![CDATA[> here]]></content>");
	});
});

describe("formatDocumentListXml", () => {
	it("empty list returns <documents></documents>", () => {
		const xml = formatDocumentListXml([]);
		expect(xml).toContain("<documents>");
		expect(xml).toContain("</documents>");
		expect(xml).not.toContain("<document>");
	});

	it("list entry includes id, title, type — not content", () => {
		const xml = formatDocumentListXml([makeDocument()]);
		expect(xml).toContain("<id>doc-1</id>");
		expect(xml).toContain("<title>My Document</title>");
		expect(xml).toContain("<type>readme</type>");
		expect(xml).not.toContain("<content>");
		expect(xml).not.toContain("<created_date>");
	});

	it("wraps root tag with query attribute when query provided", () => {
		const xml = formatDocumentListXml([makeDocument()], { query: "hello world" });
		expect(xml).toContain('<documents query="hello world">');
	});

	it("escapes query attribute value", () => {
		const xml = formatDocumentListXml([], { query: 'test "quoted"' });
		expect(xml).toContain('<documents query="test &quot;quoted&quot;">');
	});

	it("renders multiple documents", () => {
		const docs = [makeDocument({ id: "doc-1", title: "First" }), makeDocument({ id: "doc-2", title: "Second" })];
		const xml = formatDocumentListXml(docs);
		expect(xml).toContain("<id>doc-1</id>");
		expect(xml).toContain("<id>doc-2</id>");
	});
});

describe("formatMilestoneListXml", () => {
	it("empty active list with no unconfigured or archived", () => {
		const xml = formatMilestoneListXml([], [], []);
		expect(xml).toContain("<milestones>");
		expect(xml).toContain("<active>");
		expect(xml).toContain("</active>");
		expect(xml).not.toContain("<unconfigured>");
		expect(xml).not.toContain("<archived_on_tasks>");
	});

	it("active milestone includes id and title", () => {
		const xml = formatMilestoneListXml([makeMilestone()], [], []);
		expect(xml).toContain("<id>m-0</id>");
		expect(xml).toContain("<title>Release 1.0</title>");
	});

	it("active milestone includes description when non-empty", () => {
		const xml = formatMilestoneListXml([makeMilestone({ description: "First release" })], [], []);
		expect(xml).toContain("<description><![CDATA[First release]]></description>");
	});

	it("omits description when empty string", () => {
		const xml = formatMilestoneListXml([makeMilestone({ description: "" })], [], []);
		expect(xml).not.toContain("<description>");
	});

	it("omits description when whitespace-only", () => {
		const xml = formatMilestoneListXml([makeMilestone({ description: "   " })], [], []);
		expect(xml).not.toContain("<description>");
	});

	it("renders unconfigured section when non-empty", () => {
		const xml = formatMilestoneListXml([], ["orphan-value"], []);
		expect(xml).toContain("<unconfigured>");
		expect(xml).toContain("<milestone>orphan-value</milestone>");
	});

	it("omits unconfigured section when empty", () => {
		const xml = formatMilestoneListXml([makeMilestone()], [], []);
		expect(xml).not.toContain("<unconfigured>");
	});

	it("renders archived_on_tasks section when non-empty", () => {
		const xml = formatMilestoneListXml([], [], ["m-2"]);
		expect(xml).toContain("<archived_on_tasks>");
		expect(xml).toContain("<milestone>m-2</milestone>");
	});

	it("omits archived_on_tasks section when empty", () => {
		const xml = formatMilestoneListXml([makeMilestone()], [], []);
		expect(xml).not.toContain("<archived_on_tasks>");
	});

	it("escapes XML chars in milestone title and IDs", () => {
		const xml = formatMilestoneListXml([makeMilestone({ title: "Release & <test>" })], [], []);
		expect(xml).toContain("<title>Release &amp; &lt;test&gt;</title>");
	});

	it("renders all three sections together", () => {
		const xml = formatMilestoneListXml([makeMilestone()], ["uncfg"], ["m-99"]);
		expect(xml).toContain("<active>");
		expect(xml).toContain("<unconfigured>");
		expect(xml).toContain("<archived_on_tasks>");
	});
});
