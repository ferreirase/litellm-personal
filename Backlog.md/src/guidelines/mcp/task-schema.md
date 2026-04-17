## Task schema reference

Quick reference for all fields available when creating and editing tasks via MCP.

### Creating a task (`task_create`)

Only `title` is required. Everything else is optional.

| Field | Type | Limits | Notes |
|-------|------|--------|-------|
| **title** | string | 1–200 chars | **Required.** |
| description | string | max 10,000 | Free-form markdown. |
| status | string | enum from config | Defaults to the project's first status (e.g. "To Do"). Case-insensitive. |
| priority | string | `high`, `medium`, `low` | |
| ordinal | number | ≥ 0 | Manual sort order. Use spaced integers (1000, 2000, 3000). |
| milestone | string | 1–100 chars | Milestone label. |
| labels | string[] | each max 50 chars | |
| assignee | string[] | each max 100 chars | |
| dependencies | string[] | task IDs, max 50 chars | Validated against existing tasks. |
| references | string[] | each max 500 chars | URLs, GitHub issues, PRs. |
| documentation | string[] | each max 500 chars | Design docs, API specs, manuals. |
| acceptanceCriteria | string[] | each max 500 chars | Created as unchecked checklist items. |
| definitionOfDoneAdd | string[] | each max 500 chars | Task-specific DoD (appended to project defaults). |
| disableDefinitionOfDoneDefaults | boolean | | Skip project-level DoD for this task. |
| parentTaskId | string | max 50 chars | Makes this a subtask. Cannot be changed after creation. |
| finalSummary | string | max 20,000 | PR-style completion notes. Usually set when completing. |

**Auto-generated on create:** `id` (e.g. TASK-1), `createdDate` (timestamp), and project-level Definition of Done defaults (unless disabled).

### Editing a task (`task_edit`)

Only `id` is required. Pass any combination of the fields below.

#### Metadata (replace)

| Field | Type | Limits | Notes |
|-------|------|--------|-------|
| **id** | string | 1–50 chars | **Required.** Task to edit. |
| title | string | max 200 | |
| description | string | max 10,000 | |
| status | string | enum from config | |
| priority | string | `high`, `medium`, `low` | |
| ordinal | number | ≥ 0 | |
| milestone | string or null | 1–100 chars | Pass `null` to clear. |
| labels | string[] | each max 50 chars | Replaces all labels. |
| assignee | string[] | each max 100 chars | Replaces all assignees. |
| dependencies | string[] | each max 50 chars | Replaces all dependencies. |

#### References and documentation (replace, add, or remove)

| Field | Type | Notes |
|-------|------|-------|
| references | string[] | Replace all references. |
| addReferences | string[] | Append to existing. |
| removeReferences | string[] | Remove matching entries. |
| documentation | string[] | Replace all documentation. |
| addDocumentation | string[] | Append to existing. |
| removeDocumentation | string[] | Remove matching entries. |

#### Long-form text sections (set, append, or clear)

| Section | Set (replace) | Append | Clear |
|---------|--------------|--------|-------|
| Implementation plan | `planSet` (max 20k) | `planAppend` (string[], max 20 items × 5k) | `planClear` (boolean) |
| Implementation notes | `notesSet` (max 20k) | `notesAppend` (string[], max 20 items × 5k) | `notesClear` (boolean) |
| Final summary | `finalSummary` (max 20k) | `finalSummaryAppend` (string[], max 20 items × 5k) | `finalSummaryClear` (boolean) |

Also available on edit: `implementationNotes` (string, max 10k) as an alias for `notesSet`.

#### Acceptance criteria (checklist operations)

| Field | Type | Notes |
|-------|------|-------|
| acceptanceCriteriaSet | string[] | Replace all criteria (max 50 items). |
| acceptanceCriteriaAdd | string[] | Add new items (max 50). |
| acceptanceCriteriaRemove | number[] | Remove by 1-based index. |
| acceptanceCriteriaCheck | number[] | Mark as done by index. |
| acceptanceCriteriaUncheck | number[] | Mark as not done by index. |

#### Definition of Done (task-specific checklist)

| Field | Type | Notes |
|-------|------|-------|
| definitionOfDoneAdd | string[] | Add task-specific DoD items (max 50). |
| definitionOfDoneRemove | number[] | Remove by 1-based index. |
| definitionOfDoneCheck | number[] | Mark complete by index. |
| definitionOfDoneUncheck | number[] | Mark incomplete by index. |

Use `definition_of_done_defaults_upsert` to manage project-level DoD defaults (applied to all new tasks).

### Minimal example

```json
{ "title": "Add login page" }
```

### Full example

```json
{
  "title": "Add login page",
  "description": "OAuth2 login with GitHub provider",
  "status": "To Do",
  "priority": "high",
  "milestone": "v1.0",
  "labels": ["frontend", "auth"],
  "assignee": ["@alice"],
  "acceptanceCriteria": [
    "User can sign in with GitHub",
    "Session persists across page reload"
  ],
  "references": ["https://github.com/org/repo/issues/42"],
  "dependencies": ["TASK-3"]
}
```
