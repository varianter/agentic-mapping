# Insights

A group's qualitative answers on one admin page, and the same as one Markdown file to compile reports with an LLM outside the app.

## Decisions

- **Sources:** interviews, self-submitted maps and the survey's free-text answers (`kind: 'text'` questions). Survey numbers stay in the wave results and CSV.
- **Per person**, in the sheet's order: About (interviews only: discipline, date, client/domain/team), what good looks like, tools, one 3 × 3 grid per dimension with labelled cells (`Next level · Why it matters`), reflections.
- **Pseudonymous:** people are numbered by creation date per source (`Interview 1`, `Self-submitted map 1`), valid for one export only. Name, interviewer, `talk_to` and sheet ids are never included.
- **No noise:** blank answers are left out, and so are sheets without respondent answers.
- **Survey:** every wave, oldest first, submitted responses only, answers as plain text without role or context. A wave under 5 submitted responses keeps its count and hides its text.
- **At a glance** first: counts per source and submitted survey responses, people per grid cell (dimension × level, any question answered) as a shaded table, and the top 5 tools by how many people listed them. Plain HTML (tiles, a table, `<progress>` bars), every value printed; the file has the same as text and a Markdown table.
- **Preamble** built from the field tables (dimensions, levels, questions, reflections), so the file explains itself.
- **One source:** `compileInsights` in `server/domain/insights.ts` builds both the page and the file. No filters, no editing, no built-in prompt.

## Routes

| Route | Who | What |
| --- | --- | --- |
| `[/<group>]/insights` | Admin | The compiled answers |
| `[/<group>]/insights.md` | Admin | Download: `<group>-insights-<date>.md` (`no-group-…` without a group) |

`insights` is a reserved group id.
