# QA Studio

Generates a **Test Plan**, **Test Strategy** and **Test Cases** from a Jira Cloud issue (or pasted requirement text) using Groq, with an accuracy-first pipeline: every statement must trace back to a verbatim Jira quote, and open questions must be answered (or accepted as gaps) before the output becomes Final.

Pilot: local Jira Cloud project, `SCRUM-5` (VWO Login Dashboard).

## How accuracy is enforced

| Stage | What happens |
|---|---|
| S1 Fetch | Read-only Jira Cloud fetch: one issue, or epic + direct children (Strategy tab). Free text is also accepted. |
| S2 Requirements (P1) | LLM splits the source into atomic `REQ-xxx`. **Code verifies each quote exists verbatim in Jira**; unverifiable ones are discarded and shown. |
| S3 Gaps (P2) | LLM raises questions (missing / ambiguous / conflict). It never answers them. |
| Clarification gate | You answer each question or tick *Accept as gap*, then regenerate. Answers become `CLARIFICATION.Q-xxx` source segments. Status stays **Draft** until all are resolved. |
| S5 Generate (P3/P4/P5) | Fills the Markdown template exactly. Each item is labelled Documented / Proposed / Insufficient. |
| S6 Review (P6) | An independent reviewer prompt looks for unsupported claims, missing coverage, duplicates and invalid scenarios. |
| S7 Code validators | Template section order, valid REQ refs, Gherkin form, source-quote check, invented quoted messages, coverage (every testable REQ has a test; every REQ that needs a negative has one), near-duplicate removal. |
| Repair loop | If S6/S7 find blocking issues, the output is regenerated with that feedback (max 2 repairs). The best attempt is kept and the remaining issues are shown in the **Accuracy report**. |

LLM calls use `temperature 0`, `seed 42` and JSON mode. P1/P2 results are cached per source, so question ids stay stable across regenerations.

Human sign-off is still required. The best possible status is *Final — pending QA sign-off*.

## Layout

```
implementation/
  prompts/     P1–P6 RICE-POT prompts (.md) — edit to tune behaviour
  templates/   test_plan / test_strategy / test_cases templates (.md) — edit sections & columns
  src/backend  Node 20 + Express API, Jira, Groq, pipeline, validators, exporters, tests
  src/frontend React + Vite UI (Test Plan | Test Strategy | Test Cases | Settings)
```

## Setup

Prerequisites: Node.js 20+, a Jira Cloud API token, a Groq API key.

```powershell
cd implementation\src\backend
npm install
Copy-Item .env.example .env   # then fill in values, or use the Settings dialog in the UI
npm start                     # http://localhost:8787

cd ..\frontend
npm install
npm run dev                   # http://localhost:5173 (proxies /api to backend)
```

For a single-port setup, run `npm run build` in `frontend`; the backend then serves the built UI at http://localhost:8787.

### Configuration (`src/backend/.env`)

| Key | Notes |
|---|---|
| `JIRA_BASE_URL` | `https://<site>.atlassian.net` |
| `JIRA_EMAIL` / `JIRA_API_TOKEN` | Basic auth for Jira Cloud (read-only usage) |
| `JIRA_AC_FIELD` | Optional custom field id for Acceptance Criteria, e.g. `customfield_10035` |
| `GROQ_API_KEY` / `GROQ_MODEL` | Default model `openai/gpt-oss-120b` |
| `PRODUCT_NAME` | Used in prompts (default `VWO`) |

Secrets stay on the backend only. The Settings API returns `configured / not set`, never the values.

## Usage

1. Open **Settings** and enter your Jira and Groq details.
2. On any tab, enter `SCRUM-5` (or paste requirement text) plus optional focus context, then **Generate**.
3. Review **Gaps & questions**: answer each one or accept it as a gap, then click **Regenerate with answers**.
4. Check the **Accuracy report**: verified requirements, discarded claims, validator errors, reviewer findings.
5. Export: plan/strategy → Markdown; test cases → **Excel (.xlsx)** or **CSV**.

## Verification performed

- `npm test` in `src/backend`: 16 tests pass. They cover template parsing, the Jira ADF parser, quote verification, validators, dedupe, CSV/XLSX export (including formula-injection protection), the API error handling, and the full pipeline (requirement rejection, repair loop, clarification answers, accept-as-gap).
- Jira and Groq are **mocked** in the tests. The live integration has not been run here because it needs your credentials.
- Frontend production build: `npm run build` succeeds.

## Known limitations / next steps

- Live run against `SCRUM-5` has not been done yet. Next step: run it and compare the output against `VWO_Login_Test_Cases.docx` (recall + zero unsupported claims).
- Plan/strategy export is Markdown only (DOCX not yet added).
- Jira attachments and linked Confluence pages are not fetched yet (planned for the Virtual APOC rollout).
- The cache and run state are in memory, so restarting the backend changes nothing in Jira but clears cached P1/P2 results.
