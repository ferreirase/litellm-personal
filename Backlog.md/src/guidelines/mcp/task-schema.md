## Task schema reference

Complete field reference for creating and editing tasks via MCP.

### Field expectation by scenario

Judge the task and choose the right level of detail — don't pad trivial tasks, don't skimp on substantive ones.

**Substantive task (default)** — fill in all of these:
- `title`, `description`, `acceptanceCriteria`, `implementationPlan`

**Trivial task** (typo/lint/tiny doc edit) — `title` alone is fine.

**Spike / research task** — `title` + `description`. Skip AC/plan until the spike produces findings.

**Epic / parent task** — `title` + `description`. AC and `implementationPlan` belong on the subtasks, not the parent.

### Quality over presence

Filling a field with placeholder text to satisfy guidance is worse than leaving it empty. Examples:

**Good `acceptanceCriteria`:**
- "User can log out by clicking the header menu button"
- "POST /api/sessions returns 401 when token is expired"

**Bad `acceptanceCriteria` (skip these):**
- "Task is done"
- "Works correctly"
- "Code is good"

**Good `implementationPlan`:**
- "1. Add `logout` route in `routes/auth.ts`. 2. Clear session cookie. 3. Redirect to `/login`. 4. Add test covering expired token edge case."

**Bad `implementationPlan` (skip):**
- "Implement the feature"
- "Fix the bug"

### Creating a task (`task_create`)

Only `title` is required. Judge the task and fill what adds value.

#### Strongly recommended for substantive tasks

| Field | Type | Limits | Notes |
|-------|------|--------|-------|
| **title** | string | 1–200 chars | **Required.** Name the outcome, not the action (e.g. "Add logout button" not "Fix stuff"). |
| description | string | max 10,000 | Strongly recommended. Brief context — what it is, why it matters. A reviewer should understand the task from this alone. |
| acceptanceCriteria | string[] | each max 500 chars | Strongly recommended. Concrete, testable items. Each one independently verifiable. Created as unchecked checklist. |
| implementationPlan | string | max 20,000 | Strongly recommended. Step-by-step approach or outline of how you'll tackle it. |

#### Other optional fields

| Field | Type | Limits | Notes |
|-------|------|--------|-------|
| status | string | enum from config | Defaults to the project's first status (e.g. "To Do"). Case-insensitive. |
| priority | string | `high`, `medium`, `low` | |
| ordinal | number | ≥ 0 | Manual sort order. Use spaced integers (1000, 2000, 3000). |
| milestone | string | 1–100 chars | Milestone label. |
| labels | string[] | each max 50 chars | |
| assignee | string[] | each max 100 chars | |
| dependencies | string[] | task IDs, max 50 chars | Validated against existing tasks. |
| references | string[] | each max 500 chars | URLs, GitHub issues, PRs. |
| documentation | string[] | each max 500 chars | Design docs, API specs, manuals. |
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

### Minimal example (trivial task)

```json
{ "title": "Fix typo in README line 42" }
```

### Full example (substantive task)

```json
{
  "title": "Add logout button to header menu",
  "description": "Users currently have no way to log out from the UI. Add a logout item to the user dropdown that terminates the session and redirects to /login.",
  "implementationPlan": "1. Add menu item in `components/UserMenu.tsx`.\n2. Wire onClick to new `POST /api/sessions/logout` route.\n3. On success, clear session cookie and redirect to /login.\n4. Add test for expired token path.",
  "acceptanceCriteria": [
    "Logout option appears in the user dropdown menu",
    "Clicking it clears the session cookie and redirects to /login",
    "Expired token does not throw — user is redirected quietly"
  ],
  "priority": "medium",
  "labels": ["auth", "frontend"]
}
```
