# Survey mode

A short, repeatable, anonymous survey on AI and agentic adoption, beside the interviews in the same group. Quantitative where interviews are qualitative: what people use, how far they've got, and what the people they work for expect.

## Decisions

- **Groups** are participant namespaces, as for maps. The survey lives at `/<group>/survey`; nothing assumes consultants.
- **Waves.** An admin opens a wave in a group (default name `2026 Q4`); one open wave per group, so the survey link never changes. Close and reopen; no delete. Each wave is pinned to a questionnaire version.
- **Questions in code**, versioned (`SURVEY_V1` in `server/domain/survey.ts`). Wording changes go through a PR as a new version.
- **Anonymous.** No names, no customer names. One response per wave per browser (the `am_respondent` cookie, hashed), editable until the wave closes. Cohorts are compared, not people.
- **Steps.** Six short pages, each a real URL that saves on Next/Back (plain form posts; `<autosave-form>` saves as you go). Submit marks the response complete; only submitted responses count.
- **Pedagogic form.** Behaviourally anchored options tied to a recent time window, not bare 1–5 scales. Every option is a sentence describing a concrete state. After Submit, a mirror shows the respondent's rung on the autonomy ladder and what the next rung looks like.
- **Customer or own organization.** Step 1 asks who you mainly work for. The context step then asks about "your customer" or "your organization", stored with the response so results never mix the two. Only industry and product-development size, never names.
- **Results** per wave for admins: distributions per question, filter by role, hidden below 5 responses; free text listed. CSV export of submitted responses.
- English only. Comparing waves is a later step.

## Questionnaire (v1)

1. **About you**: role, years in product development, who you mainly work for (customer / own organization / between projects).
2. **How often**: AI use in the last two weeks; per task (filtered by role): never / tried / regularly / it's how I do it.
3. **Models and tools**: model families, then, per provider, how use splits across its tiers (Fable, Opus, Sonnet…; percentages adding up to 100 per provider, compared by size class across providers), who picks the model, tools, main tool, the **autonomy ladder** (0–6), who pays (all that apply).
4. **How it's going**: six agree/disagree statements, time saved per week, the biggest blocker.
5. **Your customer / your organization**: expectation ladder, maturity in six areas (not there / emerging / established / leading / don't know), industry, product-development size.
6. **Last word**: one thing that would help, and what the workplace should set up or enable (both optional free text), then Submit.

## Data

- `wave:<group>:<id>` = `{ id, group, name, version, status, createdAt, closedAt? }`
- `response:<waveId>:<id>` = `{ id, waveId, version, answers, createdAt, updatedAt, submittedAt?, revision }`
- `survey-respondent:<hash of browser token>:<waveId>` = `{ responseId }`

## Routes

| Route | Who | What |
| --- | --- | --- |
| `/<group>/survey` | Anyone | Intro for the open wave, or "no survey open" |
| `/<group>/survey/:step` | Anyone | One step; POST saves; `?go=` next, back or submit moves on |
| `/<group>/survey/done` | Anyone | The mirror after Submit |
| `/<group>/waves` | Admin | Waves list, open a new one, the survey link |
| `/<group>/waves/:id` | Admin | Results, close/reopen |
| `/<group>/waves/:id.csv` | Admin | CSV of submitted responses |
