# QA Studio

Generates a **Test Plan**, **Test Strategy** and **Test Cases** from a Jira Cloud issue (or pasted requirement text) using Groq. Each artifact is generated as readable Markdown in one model call.

Pilot: local Jira Cloud project, `SCRUM-5` (VWO Login Dashboard).

## Generation flow

Each tab fetches the selected Jira issue (read-only), or accepts pasted requirement text, then sends the source, artifact template, and optional testing context to Groq. The model returns Markdown directly. The backend checks Plan/Strategy headings and the Test Cases table header against their templates. Every result remains **Draft — pending human review**.

The prompt instructs Groq to treat Jira content as data, avoid inventing behavior, distinguish proposals from confirmed requirements, and use `Insufficient information to determine.` for missing facts. These instructions are not a semantic validator: review the generated content before using it.

LLM requests use `temperature 0` and `seed 42`. Text output avoids JSON parsing errors; a provider response that is genuinely malformed Markdown may still require regeneration.

## Layout

```
implementation/
  prompts/     Artifact prompts (.md) — edit to tune behaviour
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

## Deploy to Vercel

The repository root contains a Vercel Express function adapter and build configuration. From the repository root:

```powershell
npx vercel
npx vercel --prod
```

Set these variables in **Vercel Project Settings → Environment Variables** for each target environment, then redeploy:

- `JIRA_BASE_URL`
- `JIRA_EMAIL`
- `JIRA_API_TOKEN`
- `GROQ_API_KEY`
- `GROQ_MODEL` (optional; defaults to `openai/gpt-oss-120b`)
- `PRODUCT_NAME` (optional; defaults to `VWO`)

Do not upload or commit a local `.env` file. Settings are read-only on Vercel because serverless filesystem writes are not durable; update variables in the Vercel dashboard. The deployment can build without those variables, but generation will fail until valid values are configured.

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
2. On Test Plan or Test Strategy, enter an issue, epic scope, or requirement text and optional focus context, then **Generate**. The result is a draft Markdown document.
3. Review the Markdown draft and any template warnings before using it.
4. Copy or export any artifact as Markdown.

## Verification performed

- `npm test` in `src/backend`: mocked tests cover direct Markdown generation for all three artifacts, template headings/table columns, Groq response handling, template parsing, Jira ADF parsing, retained validator units, and API error handling.
- Jira and Groq are **mocked** in the tests. The live integration has not been run here because it needs your credentials.
- Frontend production build: `npm run build` succeeds.

## Known limitations / next steps

- Live run against `SCRUM-5` has not been done yet. Next step: run it and compare the output against `VWO_Login_Test_Cases.docx` (recall + zero unsupported claims).
- All artifacts are direct model-generated drafts. Template checks verify headings or table columns only; they do not prove semantic traceability or prevent every unsupported claim.
- Export format is Markdown only.
- Jira attachments and linked Confluence pages are not fetched yet (planned for the Virtual APOC rollout).
