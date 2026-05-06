import type { Task } from "../types/index.ts";
import { sortByTaskId } from "../utils/task-sorting.ts";
import { escapeXml } from "./xml-utils.ts";

function normalizeAt(s: string): string {
	return s.startsWith("@") ? s : `@${s}`;
}

export function formatTaskXml(task: Task): string {
	const lines: string[] = [];

	lines.push("<task>");
	lines.push("  <metadata>");
	lines.push(`    <id>${escapeXml(task.id)}</id>`);
	lines.push(`    <title>${escapeXml(task.title)}</title>`);
	lines.push(`    <status>${escapeXml(task.status)}</status>`);

	// Assignees
	if (task.assignee?.length) {
		lines.push("    <assignees>");
		for (const a of task.assignee) {
			lines.push(`      <assignee>${escapeXml(normalizeAt(a))}</assignee>`);
		}
		lines.push("    </assignees>");
	}

	// Reporter
	if (task.reporter) {
		lines.push(`    <reporter>${escapeXml(normalizeAt(task.reporter))}</reporter>`);
	}

	lines.push(`    <created_date>${escapeXml(task.createdDate)}</created_date>`);

	if (task.updatedDate) {
		lines.push(`    <updated_date>${escapeXml(task.updatedDate)}</updated_date>`);
	}

	// Labels
	if (task.labels?.length) {
		lines.push("    <labels>");
		for (const label of task.labels) {
			lines.push(`      <label>${escapeXml(label)}</label>`);
		}
		lines.push("    </labels>");
	}

	// Priority
	if (task.priority) {
		lines.push(`    <priority>${escapeXml(task.priority)}</priority>`);
	}

	// Milestone
	if (task.milestone) {
		lines.push(`    <milestone>${escapeXml(task.milestone)}</milestone>`);
	}

	// Dependencies
	if (task.dependencies?.length) {
		lines.push("    <dependencies>");
		for (const dep of task.dependencies) {
			lines.push(`      <dependency>${escapeXml(dep)}</dependency>`);
		}
		lines.push("    </dependencies>");
	}

	// Parent
	if (task.parentTaskId) {
		lines.push("    <parent>");
		lines.push(`      <id>${escapeXml(task.parentTaskId)}</id>`);
		const title = task.parentTaskTitle ?? task.parentTaskId;
		lines.push(`      <title>${escapeXml(title)}</title>`);
		lines.push("    </parent>");
	}

	// Subtasks
	const subtaskSummaries = task.subtaskSummaries ?? [];
	if (subtaskSummaries.length > 0) {
		const sorted = sortByTaskId(subtaskSummaries);
		lines.push("    <subtasks>");
		for (const subtask of sorted) {
			lines.push("      <subtask>");
			lines.push(`        <id>${escapeXml(subtask.id)}</id>`);
			lines.push(`        <title>${escapeXml(subtask.title)}</title>`);
			lines.push("      </subtask>");
		}
		lines.push("    </subtasks>");
	} else if (task.subtasks?.length) {
		lines.push("    <subtasks>");
		for (const subtaskId of task.subtasks) {
			lines.push("      <subtask>");
			lines.push(`        <id>${escapeXml(subtaskId)}</id>`);
			lines.push(`        <title>${escapeXml(subtaskId)}</title>`);
			lines.push("      </subtask>");
		}
		lines.push("    </subtasks>");
	}

	// References
	if (task.references?.length) {
		lines.push("    <references>");
		for (const ref of task.references) {
			lines.push(`      <reference>${escapeXml(ref)}</reference>`);
		}
		lines.push("    </references>");
	}

	// Documentation
	if (task.documentation?.length) {
		lines.push("    <documentation>");
		for (const doc of task.documentation) {
			lines.push(`      <doc>${escapeXml(doc)}</doc>`);
		}
		lines.push("    </documentation>");
	}

	lines.push("  </metadata>");

	// Description (always present)
	const description = task.description?.trim() ?? "";
	lines.push("  <description>");
	for (const line of description.split("\n")) {
		lines.push(`    ${escapeXml(line)}`);
	}
	lines.push("  </description>");

	// Acceptance Criteria
	const acItems = task.acceptanceCriteriaItems;
	if (acItems?.length) {
		const sorted = acItems.slice().sort((a, b) => a.index - b.index);
		lines.push("  <acceptance_criteria>");
		for (const item of sorted) {
			lines.push(`    <item index="${item.index}" checked="${item.checked}">${escapeXml(item.text)}</item>`);
		}
		lines.push("  </acceptance_criteria>");
	}

	// Definition of Done
	const dodItems = task.definitionOfDoneItems;
	if (dodItems?.length) {
		const sorted = dodItems.slice().sort((a, b) => a.index - b.index);
		lines.push("  <definition_of_done>");
		for (const item of sorted) {
			lines.push(`    <item index="${item.index}" checked="${item.checked}">${escapeXml(item.text)}</item>`);
		}
		lines.push("  </definition_of_done>");
	}

	// Implementation Plan
	const implementationPlan = task.implementationPlan?.trim();
	if (implementationPlan) {
		lines.push("  <implementation_plan>");
		for (const line of implementationPlan.split("\n")) {
			lines.push(`    ${escapeXml(line)}`);
		}
		lines.push("  </implementation_plan>");
	}

	// Implementation Notes
	const implementationNotes = task.implementationNotes?.trim();
	if (implementationNotes) {
		lines.push("  <implementation_notes>");
		for (const line of implementationNotes.split("\n")) {
			lines.push(`    ${escapeXml(line)}`);
		}
		lines.push("  </implementation_notes>");
	}

	// Final Summary
	const finalSummary = task.finalSummary?.trim();
	if (finalSummary) {
		lines.push("  <final_summary>");
		for (const line of finalSummary.split("\n")) {
			lines.push(`    ${escapeXml(line)}`);
		}
		lines.push("  </final_summary>");
	}

	lines.push("</task>");

	return lines.join("\n");
}

export function formatTaskListXml(tasks: Task[], options: { query?: string } = {}): string {
	const lines: string[] = [];

	lines.push("<tasks>");

	if (options.query) {
		lines.push(`  <query>${escapeXml(options.query)}</query>`);
	}

	for (const task of tasks) {
		lines.push("  <task>");
		lines.push(`    <id>${escapeXml(task.id)}</id>`);
		lines.push(`    <title>${escapeXml(task.title)}</title>`);
		lines.push(`    <status>${escapeXml(task.status)}</status>`);
		if (task.priority) {
			lines.push(`    <priority>${escapeXml(task.priority)}</priority>`);
		}
		lines.push("  </task>");
	}

	lines.push("</tasks>");

	return lines.join("\n");
}
