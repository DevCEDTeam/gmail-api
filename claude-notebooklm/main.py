"""Flask API for Claude-NotebookLM bidirectional sync pipeline.

Cloud Run ready. Exposes endpoints for Claude Code hooks to push
session metadata to NotebookLM and pull research context back.
"""

import json
import logging
import os

from flask import Flask, jsonify, request

from core.claude_engine import ClaudeEngine
from core.notebooklm_client import NotebookLMClient, NotebookLMError
from core.sync_pipeline import SyncPipeline

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

app = Flask(__name__)

# -- Configuration --

NLM_API_KEY = os.environ.get("NOTEBOOKLM_API_KEY", "")
NLM_BASE_URL = os.environ.get(
    "NOTEBOOKLM_BASE_URL",
    "https://notebooklm.googleapis.com/v1",
)

# Lazy-initialized pipeline
_pipeline = None


def get_pipeline() -> SyncPipeline:
    """Get or create the sync pipeline singleton."""
    global _pipeline
    if _pipeline is None:
        client = NotebookLMClient(api_key=NLM_API_KEY, base_url=NLM_BASE_URL)
        engine = ClaudeEngine()
        _pipeline = SyncPipeline(client=client, engine=engine)
    return _pipeline


# -- Health / Info --

@app.route("/", methods=["GET"])
def index():
    """Service info endpoint."""
    return jsonify({
        "service": "claude-notebooklm-sync",
        "version": "1.0.0",
        "status": "ok",
        "endpoints": [
            "POST /notebooks - Create a new NotebookLM notebook",
            "POST /hook   - Process Claude Code hook event (with model, hash, summary)",
            "POST /push   - Push sources to NotebookLM (batch)",
            "POST /pull   - Pull context from NotebookLM",
            "POST /ground - Grounded query with citations against NLM sources",
            "POST /sync   - Bidirectional sync with enrichment loop",
            "GET  /registry - View sync registry + knowledge loop stats",
            "GET  /health - Health check",
        ],
    })


@app.route("/health", methods=["GET"])
def health():
    """Health check for Cloud Run."""
    return jsonify({"status": "healthy"}), 200


# -- Notebook operations --

@app.route("/notebooks", methods=["POST"])
def create_notebook():
    """Create a new NotebookLM notebook.

    Expects JSON body with title (required).
    Returns the created notebook record.
    """
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Request body must be JSON"}), 400

    title = data.get("title")
    if not title:
        return jsonify({"error": "title is required"}), 400

    pipeline = get_pipeline()
    try:
        result = pipeline.client.create_notebook(title)
        return jsonify(result), 201
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# -- Hook event processing --

@app.route("/hook", methods=["POST"])
def process_hook():
    """Process a Claude Code hook event.

    Expects JSON body with hook event data and a notebook_id parameter.
    """
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Request body must be JSON"}), 400

    notebook_id = data.pop("notebook_id", None) or request.args.get("notebook_id")
    if not notebook_id:
        return jsonify({"error": "notebook_id is required"}), 400

    pipeline = get_pipeline()
    result = pipeline.push_hook_event(notebook_id, data)

    status_code = 200 if result["status"] == "completed" else 500
    return jsonify(result), status_code


# -- Push operations --

@app.route("/push", methods=["POST"])
def push_sources():
    """Push one or more sources to NotebookLM.

    Expects JSON body with notebook_id and events (list of hook events).
    """
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Request body must be JSON"}), 400

    notebook_id = data.get("notebook_id")
    if not notebook_id:
        return jsonify({"error": "notebook_id is required"}), 400

    events = data.get("events", [])
    if not events:
        return jsonify({"error": "events list is required"}), 400

    pipeline = get_pipeline()
    result = pipeline.push_batch(notebook_id, events)

    return jsonify(result), 200


# -- Pull operations --

@app.route("/pull", methods=["POST"])
def pull_context():
    """Pull research context from NotebookLM.

    Expects JSON body with notebook_id and optional filters.
    """
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Request body must be JSON"}), 400

    notebook_id = data.get("notebook_id")
    if not notebook_id:
        return jsonify({"error": "notebook_id is required"}), 400

    pipeline = get_pipeline()
    result = pipeline.pull_context(
        notebook_id=notebook_id,
        source_type=data.get("source_type"),
        since=data.get("since"),
        limit=data.get("limit", 20),
    )

    return jsonify(result), 200


# -- Grounded query --

@app.route("/ground", methods=["POST"])
def grounded_query():
    """Query NotebookLM sources and get a grounded answer with citations.

    Expects JSON body with notebook_id and query string.
    """
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Request body must be JSON"}), 400

    notebook_id = data.get("notebook_id")
    if not notebook_id:
        return jsonify({"error": "notebook_id is required"}), 400

    query = data.get("query")
    if not query:
        return jsonify({"error": "query is required"}), 400

    pipeline = get_pipeline()
    result = pipeline.grounded_pull(
        notebook_id=notebook_id,
        query=query,
        source_type=data.get("source_type"),
        limit=data.get("limit", 20),
    )

    return jsonify(result), 200


# -- Bidirectional sync with enrichment --

@app.route("/sync", methods=["POST"])
def full_sync():
    """Perform a full bidirectional sync with enrichment loop.

    Pull → Claude enriches → Push back → Registry updated.
    Expects JSON body with notebook_id and optional push_events.
    """
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Request body must be JSON"}), 400

    notebook_id = data.get("notebook_id")
    if not notebook_id:
        return jsonify({"error": "notebook_id is required"}), 400

    pipeline = get_pipeline()
    result = pipeline.full_sync(
        notebook_id=notebook_id,
        push_events=data.get("push_events"),
        pull_source_type=data.get("pull_source_type"),
        enrich=data.get("enrich", True),
    )

    return jsonify(result), 200


# -- Registry --

@app.route("/registry", methods=["GET"])
def view_registry():
    """View the current sync registry and knowledge loop stats."""
    pipeline = get_pipeline()
    limit = request.args.get("limit", 50, type=int)
    registry = pipeline.get_registry()

    return jsonify({
        "source_count": pipeline.get_source_count(),
        "sync_history": pipeline.get_sync_history(limit=limit),
        "knowledge_loop": registry.get("knowledge_loop", {}),
    })


# -- Entry point --

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    debug = os.environ.get("FLASK_DEBUG", "false").lower() == "true"
    app.run(host="0.0.0.0", port=port, debug=debug)
