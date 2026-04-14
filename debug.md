# Debug Session

- Status: OPEN
- Symptom: `POST /api/chat` returns `500 Internal Server Error` after switching to OpenRouter.
- Scope: `src/app/api/chat/route.ts`

## Hypotheses

1. `OPENROUTER_API_KEY` is not loaded into the Next.js runtime, causing upstream auth failure.
2. The selected model `google/gemma-4-31b-it:free` does not support the current tool-calling flow and the SDK throws during `streamText`.
3. OpenRouter requires additional request headers or rejects the current request shape.
4. The request reaches `/api/chat`, but `messages` from the frontend are malformed for the current SDK/runtime combination.
5. The upstream provider returns an error payload that is currently unhandled, and our route lets it bubble to a 500.

## Evidence

- Confirmed: Hypothesis 5. Runtime log shows OpenRouter responded with `429` and payload:
  `google/gemma-4-31b-it:free is temporarily rate-limited upstream`.
- Rejected: Hypothesis 1. `.env.local` contains `OPENROUTER_API_KEY`, and Next loads `.env.local`.
- Rejected: Hypothesis 4. Request body reaches `streamText` and includes valid `messages` and `tools`.
- Inconclusive: Hypothesis 2. The failure occurs before model capability can be evaluated because the upstream route is rate-limited.
- Unlikely: Hypothesis 3. Request hits OpenRouter successfully; the failure is not header rejection but provider rate limit.
