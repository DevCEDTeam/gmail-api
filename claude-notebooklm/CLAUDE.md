# Claude-NotebookLM Bidirectional Sync Pipeline

## Architecture Overview

This pipeline enables two-way metadata exchange between Claude Code's hook system and Google NotebookLM. It runs as a Flask API on Cloud Run, processing hook events into structured sources and syncing them bidirectionally.

```
┌─────────────────┐     stdin/stdout      ┌──────────────────┐
│   Claude Code   │◄────────────────────►│   Hook Scripts   │
│   (IDE/CLI)     │    JSON events        │  (settings.json) │
└────────┬────────┘                       └────────┬─────────┘
         │                                         │
         │  HTTP POST /hook                        │
         ▼                                         ▼
┌──────────────────────────────────────────────────────────────┐
│                    Flask API (main.py)                        │
│  /hook  /push  /pull  /sync  /registry  /health              │
└────────┬─────────────────────────────────┬───────────────────┘
         │                                 │
         ▼                                 ▼
┌──────────────────┐            ┌──────────────────────┐
│  ClaudeEngine    │            │  SyncPipeline        │
│  (claude_engine) │            │  (sync_pipeline)     │
│                  │            │                      │
│  • classify      │◄──────────►│  • push_hook_event   │
│  • process_hook  │            │  • pull_context      │
│  • reasoning     │            │  • full_sync         │
│  • architecture  │            │  • registry mgmt     │
└──────────────────┘            └──────────┬───────────┘
                                           │
                                           ▼
                                ┌──────────────────────┐
                                │  NotebookLMClient    │
                                │  (notebooklm_client) │
                                │                      │
                                │  • push_source       │
                                │  • pull_sources      │
                                │  • pull_summary      │
                                │  • CRUD notebooks    │
                                └──────────┬───────────┘
                                           │
                                           ▼
                                ┌──────────────────────┐
                                │   Google NotebookLM  │
                                │   (External API)     │
                                └──────────────────────┘
```

## Data Flow

### Push Flow (Claude Code → NotebookLM)
1. Claude Code hook fires (PreToolUse, PostToolUse, etc.)
2. Hook script sends JSON event to Flask API via `POST /hook`
3. `ClaudeEngine.process_hook_event()` classifies and enriches the event
4. `SyncPipeline` deduplicates via content hash against registry
5. `NotebookLMClient.push_source()` uploads to NotebookLM notebook
6. Registry records the sync operation

### Pull Flow (NotebookLM → Claude Code)
1. SessionStart hook or PreToolUse hook calls `POST /pull`
2. `SyncPipeline.pull_context()` fetches sources from NotebookLM
3. Sources are returned as structured context for session injection
4. Claude Code hook script writes context to stdout for injection

## Six Claude Code Source Types

| Source Type | Description |
|---|---|
| `hook_event` | Raw hook payloads (PreToolUse, PostToolUse, etc.) |
| `session_transcript` | Conversation flow between user and Claude Code |
| `code_diff` | Git diffs and file changes with annotations |
| `tool_invocation` | Structured tool call records (Read, Edit, Bash, etc.) |
| `reasoning_trace` | Decision rationale and architectural reasoning |
| `architecture_note` | System design observations and dependency maps |

## Configuration

### Environment Variables
- `NOTEBOOKLM_API_KEY` — API key for NotebookLM access
- `NOTEBOOKLM_BASE_URL` — API base URL (default: `https://notebooklm.googleapis.com/v1`)
- `PORT` — Server port (default: `8080`)
- `LOG_LEVEL` — Logging level (default: `INFO`)
- `FLASK_DEBUG` — Enable debug mode (`true`/`false`)

### Registry
The live metadata registry (`config/registry.json`) auto-grows as syncs occur. It tracks:
- **source_index**: Content hash → source mapping for deduplication
- **sync_history**: Chronological log of all push/pull operations
- **notebooks**: Referenced notebook metadata

## Running

```bash
# Local development
pip install -r requirements.txt
python main.py

# Docker
docker build -t claude-notebooklm .
docker run -p 8080:8080 -e NOTEBOOKLM_API_KEY=your-key claude-notebooklm

# Tests
pytest tests/ -v
```

## API Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/` | Service info |
| GET | `/health` | Health check |
| POST | `/hook` | Process a single hook event |
| POST | `/push` | Batch push sources |
| POST | `/pull` | Pull research context |
| POST | `/sync` | Full bidirectional sync |
| GET | `/registry` | View sync registry |
