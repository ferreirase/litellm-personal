import { describe, expect, it } from "bun:test";
import { formatTaskListXml, formatTaskXml } from "../formatters/task-xml.ts";
import type { Task } from "../types/index.ts";

function makeTask(overrides: Partial<Task> = {}): Task {
	return {
		id: "TASK-1",
		title: "Sample task",
		status: "To Do",
		assignee: [],
		labels: [],
		dependencies: [],
		createdDate: "2025-07-01",
		...overrides,
	};
}

describe("formatTaskXml", () => {
	it("minimal task — only required fields, no empty collection elements", () => {
		const xml = formatTaskXml(makeTask());
		expect(xml).toContain("<id>TASK-1</id>");
		expect(xml).toContain("<title>Sample task</title>");
		expect(xml).toContain("<status>To Do</status>");
		expect(xml).toContain("<created_date>2025-07-01</created_date>");
		// Optional elements absent
		expect(xml).not.toContain("<assignees>");
		expect(xml).not.toContain("<labels>");
		expect(xml).not.toContain("<dependencies>");
		expect(xml).not.toContain("<priority>");
		expect(xml).not.toContain("<milestone>");
		expect(xml).not.toContain("<updated_date>");
		expect(xml).not.toContain("<references>");
		expect(xml).not.toContain("<subtasks>");
		expect(xml).not.toContain("<acceptance_criteria>");
		expect(xml).not.toContain("<definition_of_done>");
		expect(xml).not.toContain("<implementation_plan>");
		expect(xml).not.toContain("<implementation_notes>");
		expect(xml).not.toContain("<final_summary>");
	});

	it("full task — every element present with correct content", () => {
		const task = makeTask({
			id: "BACK-42",
			title: "Implement OAuth",
			status: "In Progress",
			assignee: ["@sara", "claude"],
			reporter: "author",
			createdDate: "2025-07-12 09:30",
			updatedDate: "2025-07-13 14:55",
			labels: ["auth", "backend"],
			priority: "high",
			milestone: "v1.0",
			dependencies: ["BACK-10", "BACK-15"],
			parentTaskId: "BACK-14",
			parentTaskTitle: "Parent task title",
			subtaskSummaries: [{ id: "BACK-42.1", title: "Subtask one" }],
			references: ["https://example.com"],
			documentation: ["docs/guide.md"],
			description: "OAuth 2.0 support",
			acceptanceCriteriaItems: [
				{ index: 1, text: "Login works", checked: true },
				{ index: 2, text: "Tests written", checked: false },
			],
			definitionOfDoneItems: [{ index: 1, text: "Code reviewed", checked: true }],
			implementationPlan: "1. Research\n2. Implement",
			implementationNotes: "Research done",
			finalSummary: "Completed OAuth",
		});

		const xml = formatTaskXml(task);

		expect(xml).toContain("<id>BACK-42</id>");
		expect(xml).toContain("<title>Implement OAuth</title>");
		expect(xml).toContain("<status>In Progress</status>");
		expect(xml).toContain("<assignee>@sara</assignee>");
		expect(xml).toContain("<assignee>@claude</assignee>");
		expect(xml).toContain("<reporter>@author</reporter>");
		expect(xml).toContain("<created_date>2025-07-12 09:30</created_date>");
		expect(xml).toContain("<updated_date>2025-07-13 14:55</updated_date>");
		expect(xml).toContain("<label>auth</label>");
		expect(xml).toContain("<label>backend</label>");
		expect(xml).toContain("<priority>high</priority>");
		expect(xml).toContain("<milestone>v1.0</milestone>");
		expect(xml).toContain("<dependency>BACK-10</dependency>");
		expect(xml).toContain("<dependency>BACK-15</dependency>");
		expect(xml).toContain('<parent id="BACK-14">Parent task title</parent>');
		expect(xml).toContain('id="BACK-42.1"');
		expect(xml).toContain("Subtask one");
		expect(xml).toContain("<reference>https://example.com</reference>");
		expect(xml).toContain("<doc>docs/guide.md</doc>");
		expect(xml).toContain("OAuth 2.0 support");
		expect(xml).toContain('index="1" checked="true"');
		expect(xml).toContain('index="2" checked="false"');
		expect(xml).toContain("<definition_of_done>");
		expect(xml).toContain("1. Research");
		expect(xml).toContain("Research done");
		expect(xml).toContain("Completed OAuth");
	});

	it("XML escaping — special chars in title/labels are escaped", () => {
		const task = makeTask({
			title: "Fix <script> & \"XSS\" 'injection'",
			labels: ["a&b", "<tag>"],
		});

		const xml = formatTaskXml(task);
		expect(xml).toContain("Fix &lt;script&gt; &amp; &quot;XSS&quot; &apos;injection&apos;");
		expect(xml).toContain("a&amp;b");
		expect(xml).toContain("&lt;tag&gt;");
	});

	it("CDATA content — markdown in description survives without corruption", () => {
		const task = makeTask({
			description: "# Heading\n\n- item 1\n- item 2\n\n`code` and **bold**",
		});

		const xml = formatTaskXml(task);
		expect(xml).toContain("<![CDATA[");
		expect(xml).toContain("# Heading");
		expect(xml).toContain("`code` and **bold**");
	});

	it("CDATA edge case — ]]> in content is properly escaped", () => {
		const task = makeTask({ description: "end of cdata: ]]> marker" });
		const xml = formatTaskXml(task);
		// The raw "]]> marker" sequence should not appear unescaped inside CDATA
		expect(xml).not.toContain("]]> marker");
		// But the content must still be recoverable
		expect(xml).toContain("end of cdata");
		expect(xml).toContain("marker");
	});

	it("assignee normalization — @ prefix added when missing, not doubled", () => {
		const task = makeTask({ assignee: ["alice", "@bob"] });
		const xml = formatTaskXml(task);
		expect(xml).toContain("<assignee>@alice</assignee>");
		expect(xml).toContain("<assignee>@bob</assignee>");
		expect(xml).not.toContain("@@bob");
	});

	it("subtasks with subtaskSummaries — sorted by ID, id attribute format", () => {
		const task = makeTask({
			subtaskSummaries: [
				{ id: "TASK-1.10", title: "Tenth" },
				{ id: "TASK-1.2", title: "Second" },
				{ id: "TASK-1.1", title: "First" },
			],
		});

		const xml = formatTaskXml(task);
		const idx1 = xml.indexOf('TASK-1.1"');
		const idx2 = xml.indexOf('TASK-1.2"');
		const idx10 = xml.indexOf('TASK-1.10"');
		// Sorted numerically: 1 < 2 < 10
		expect(idx1).toBeLessThan(idx2);
		expect(idx2).toBeLessThan(idx10);
	});

	it("subtasks fallback — subtasks[] string array when no summaries", () => {
		const task = makeTask({
			subtaskSummaries: [],
			subtasks: ["TASK-1.1", "TASK-1.2"],
		});

		const xml = formatTaskXml(task);
		expect(xml).toContain("<subtasks>");
		expect(xml).toContain('id="TASK-1.1"');
		expect(xml).toContain('id="TASK-1.2"');
	});

	it("AC/DoD ordering — sorted by index ascending regardless of input order", () => {
		const task = makeTask({
			acceptanceCriteriaItems: [
				{ index: 3, text: "Third", checked: false },
				{ index: 1, text: "First", checked: true },
				{ index: 2, text: "Second", checked: false },
			],
		});

		const xml = formatTaskXml(task);
		const idxFirst = xml.indexOf("First");
		const idxSecond = xml.indexOf("Second");
		const idxThird = xml.indexOf("Third");
		expect(idxFirst).toBeLessThan(idxSecond);
		expect(idxSecond).toBeLessThan(idxThird);
	});

	it("internal fields omitted — filePath, source, ordinal, branch not in output", () => {
		const task = makeTask({
			filePath: "/some/path/task.md",
			source: "local",
			ordinal: 5,
			branch: "main",
		});

		const xml = formatTaskXml(task);
		expect(xml).not.toContain("/some/path/task.md");
		expect(xml).not.toContain("<source>");
		expect(xml).not.toContain("<ordinal>");
		expect(xml).not.toContain("<branch>");
	});

	it("parent with title — <parent id='...'> contains title text", () => {
		const task = makeTask({
			parentTaskId: "TASK-10",
			parentTaskTitle: "The parent task",
		});

		const xml = formatTaskXml(task);
		expect(xml).toContain('<parent id="TASK-10">The parent task</parent>');
	});

	it("parent without title — <parent id='...'> falls back to ID as text", () => {
		const task = makeTask({ parentTaskId: "TASK-10" });
		const xml = formatTaskXml(task);
		expect(xml).toContain('<parent id="TASK-10">TASK-10</parent>');
	});
});

describe("formatTaskListXml", () => {
	it("returns <tasks> with lightweight task entries", () => {
		const tasks: Task[] = [
			makeTask({ id: "TASK-1", title: "First", status: "To Do", priority: "high" }),
			makeTask({ id: "TASK-2", title: "Second", status: "In Progress" }),
		];

		const xml = formatTaskListXml(tasks);
		expect(xml).toContain("<tasks>");
		expect(xml).toContain("</tasks>");
		expect(xml).toContain("<id>TASK-1</id>");
		expect(xml).toContain("<priority>high</priority>");
		expect(xml).toContain("<id>TASK-2</id>");
		// No priority element when absent
		const task2Block = xml.slice(xml.indexOf("<id>TASK-2</id>"));
		const nextTaskIdx = task2Block.indexOf("</task>");
		expect(task2Block.slice(0, nextTaskIdx)).not.toContain("<priority>");
	});

	it("includes query attribute when provided", () => {
		const xml = formatTaskListXml([makeTask()], { query: "oauth" });
		expect(xml).toContain('<tasks query="oauth">');
	});

	it("escapes query attribute value", () => {
		const xml = formatTaskListXml([], { query: 'a&b "test"' });
		expect(xml).toContain('<tasks query="a&amp;b &quot;test&quot;">');
	});
});
