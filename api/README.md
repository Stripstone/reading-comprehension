# Vercel API (Reading Comprehension Grader)

## Endpoints

### POST /api/evaluate
Body:
- pageText (string) OR passageText
- userText (string) OR consolidation
- model (optional)

Response:
- { "feedback": "<4 lines>" }

### GET /api/health
Response:
- { ok, hasOpenAIKey, model }

## Env vars (Vercel Project Settings)
- OPENAI_API_KEY=...
- OPENAI_MODEL=gpt-5   (or whatever you want)

## CORS
Allowlisted origins live in:
- api/_lib/http.js
