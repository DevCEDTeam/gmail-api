# Prompt: Create a New NotebookLM Notebook Named "hello"

## Claude Code Hook Script (SessionStart)

Use this prompt as a **SessionStart hook** in Claude Code's `settings.json`
to automatically create a new NotebookLM notebook named **"hello"** when a
coding session begins.

### Hook Configuration (settings.json)

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "",
        "command": "curl -s -X POST http://localhost:8080/notebooks -H 'Content-Type: application/json' -d '{\"title\": \"hello\"}'",
        "timeout": 10000
      }
    ]
  }
}
```

### Direct API Call

To create the notebook immediately via the running Flask API:

```bash
curl -X POST http://localhost:8080/notebooks \
  -H "Content-Type: application/json" \
  -d '{"title": "hello"}'
```

**Expected response** (HTTP 201):

```json
{
  "title": "hello",
  "created_at": "2026-03-22T14:00:00.000000+00:00"
}
```

### Python (programmatic)

```python
from core.notebooklm_client import NotebookLMClient

client = NotebookLMClient(api_key="YOUR_NOTEBOOKLM_API_KEY")
notebook = client.create_notebook("hello")
print(f"Created notebook: {notebook}")
```

### After Creation — Push First Source

Once the notebook is created, push an initial source to seed it:

```bash
curl -X POST http://localhost:8080/hook \
  -H "Content-Type: application/json" \
  -d '{
    "notebook_id": "<notebook_id from create response>",
    "hook_type": "SessionStart",
    "tool_name": "init",
    "description": "New Claude Code session initialized — notebook hello created"
  }'
```

### Full Flow: Create → Push → Sync

```bash
# 1. Create the notebook
NOTEBOOK=$(curl -s -X POST http://localhost:8080/notebooks \
  -H "Content-Type: application/json" \
  -d '{"title": "hello"}')

NOTEBOOK_ID=$(echo $NOTEBOOK | python3 -c "import sys,json; print(json.load(sys.stdin).get('notebook_id',''))")

# 2. Push an initial hook event as the first source
curl -s -X POST http://localhost:8080/hook \
  -H "Content-Type: application/json" \
  -d "{
    \"notebook_id\": \"$NOTEBOOK_ID\",
    \"hook_type\": \"SessionStart\",
    \"description\": \"Notebook hello created and seeded from Claude Code\"
  }"

# 3. Run a bidirectional sync with enrichment
curl -s -X POST http://localhost:8080/sync \
  -H "Content-Type: application/json" \
  -d "{
    \"notebook_id\": \"$NOTEBOOK_ID\",
    \"enrich\": true
  }"
```

### Data Flow

```
Claude Code                          NotebookLM
    │                                     │
    │  POST /notebooks {"title":"hello"}  │
    │────────────────────────────────────►│
    │                                     │
    │  ◄── notebook_id returned ─────────│
    │                                     │
    │  POST /hook (SessionStart event)    │
    │────────────────────────────────────►│
    │   (model, hash, summary, tags       │
    │    metadata attached)               │
    │                                     │
    │  POST /sync (enrichment loop)       │
    │────────────────────────────────────►│
    │  ◄── pull sources ─────────────────│
    │  ── enrich ── push back ──────────►│
    │                                     │
    │  "hello" notebook now has:          │
    │   • Session start source            │
    │   • Enriched reasoning trace        │
    │   • Registry updated                │
```
