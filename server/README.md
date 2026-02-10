# AI-World Backend

## Purpose
Express proxy service for the dual-pane AI workspace:
- validates client payload
- calls DeepSeek model
- enforces strict JSON response schema
- returns normalized assistant + board actions

## Endpoints
- `GET /api/health`: liveness and runtime info
- `GET /api/ready`: readiness (checks model API key)
- `POST /api/ai/agent`: main agent endpoint (rate-limited)

## Environment
Use `server/.env.example` as reference.

Required:
- `DEEPSEEK_API_KEY`

Common controls:
- `PORT`
- `CORS_ORIGINS`
- `AI_MODEL_PRIMARY`, `AI_MODEL_FALLBACK`
- `AI_MAX_TOKENS`, `AI_TIMEOUT_MS`
- `MAX_MESSAGES`, `MAX_MESSAGE_CHARS`
- `MAX_BOARD_SECTIONS`, `MAX_SECTION_TITLE_CHARS`, `MAX_SECTION_CONTENT_CHARS`
- `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX`

## Scripts
- `npm run dev`
- `npm run build`
- `npm run test`
