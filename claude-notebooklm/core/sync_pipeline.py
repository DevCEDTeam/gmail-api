"""Bidirectional sync orchestrator and registry.

Coordinates the push/pull flow between Claude Code and NotebookLM,
maintains a live registry of all synced metadata, and handles
conflict resolution and deduplication.
"""

import json
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Optional

from core.claude_engine import ClaudeEngine
from core.notebooklm_client import NotebookLMClient, NotebookLMError

logger = logging.getLogger(__name__)

REGISTRY_PATH = os.path.join(
    os.path.dirname(os.path.dirname(__file__)),
    "config",
    "registry.json",
)


class SyncError(Exception):
    """Raised when a sync operation fails."""


class SyncPipeline:
    """Orchestrates bidirectional metadata sync between Claude Code and NotebookLM.

    Push flow: Claude Code hook events -> ClaudeEngine -> NotebookLMClient -> NotebookLM
    Pull flow: NotebookLM -> NotebookLMClient -> context injection -> Claude Code session
    """

    def __init__(
        self,
        client: NotebookLMClient,
        engine: Optional[ClaudeEngine] = None,
        registry_path: str = REGISTRY_PATH,
    ):
        self.client = client
        self.engine = engine or ClaudeEngine()
        self.registry_path = registry_path
        self._registry = self._load_registry()

    # -- Push operations (Claude Code -> NotebookLM) --

    def push_hook_event(self, notebook_id: str, event: dict) -> dict:
        """Process a hook event and push it to NotebookLM.

        Args:
            notebook_id: Target notebook ID.
            event: Raw hook event from Claude Code stdin.

        Returns:
            Sync record with status and source details.
        """
        sync_id = str(uuid.uuid4())
        sync_record = self._create_sync_record(sync_id, "push")

        try:
            entry = self.engine.process_hook_event(event)
            content_hash = self.engine.content_hash(entry["content"])

            if self._is_duplicate(content_hash):
                sync_record["status"] = "completed"
                sync_record["sources_transferred"] = 0
                sync_record["note"] = "duplicate_skipped"
                self._record_sync(sync_record)
                return sync_record

            result = self.client.push_source(
                notebook_id=notebook_id,
                source_type=entry["source_type"],
                title=entry["title"],
                content=entry["content"],
                metadata=entry.get("metadata"),
            )

            self._register_source(content_hash, result)
            sync_record["status"] = "completed"
            sync_record["sources_transferred"] = 1
            sync_record["source_id"] = result.get("source_id")

        except NotebookLMError as e:
            sync_record["status"] = "failed"
            sync_record["error"] = str(e)
            logger.error("Push failed: %s", e)
        except Exception as e:
            sync_record["status"] = "failed"
            sync_record["error"] = str(e)
            logger.error("Unexpected push error: %s", e)

        self._record_sync(sync_record)
        return sync_record

    def push_batch(self, notebook_id: str, events: list[dict]) -> dict:
        """Push multiple hook events to NotebookLM.

        Args:
            notebook_id: Target notebook ID.
            events: List of raw hook events.

        Returns:
            Batch sync summary.
        """
        results = []
        succeeded = 0
        failed = 0

        for event in events:
            record = self.push_hook_event(notebook_id, event)
            results.append(record)
            if record["status"] == "completed":
                succeeded += 1
            else:
                failed += 1

        return {
            "total": len(events),
            "succeeded": succeeded,
            "failed": failed,
            "records": results,
        }

    # -- Pull operations (NotebookLM -> Claude Code) --

    def pull_context(
        self,
        notebook_id: str,
        source_type: Optional[str] = None,
        since: Optional[str] = None,
        limit: int = 20,
    ) -> dict:
        """Pull research context from NotebookLM for session injection.

        Args:
            notebook_id: Source notebook ID.
            source_type: Optional filter by source type.
            since: Optional ISO timestamp for incremental pulls.
            limit: Maximum number of sources.

        Returns:
            Sync record with pulled sources.
        """
        sync_id = str(uuid.uuid4())
        sync_record = self._create_sync_record(sync_id, "pull")

        try:
            sources = self.client.pull_sources(
                notebook_id=notebook_id,
                source_type=source_type,
                since=since,
                limit=limit,
            )

            sync_record["status"] = "completed"
            sync_record["sources_transferred"] = len(sources)
            sync_record["sources"] = sources

        except NotebookLMError as e:
            sync_record["status"] = "failed"
            sync_record["error"] = str(e)
            sync_record["sources"] = []
            logger.error("Pull failed: %s", e)

        self._record_sync(sync_record)
        return sync_record

    def pull_summary(self, notebook_id: str) -> dict:
        """Pull the notebook summary for high-level context injection.

        Args:
            notebook_id: Source notebook ID.

        Returns:
            Summary data from NotebookLM.
        """
        sync_id = str(uuid.uuid4())
        sync_record = self._create_sync_record(sync_id, "pull")

        try:
            summary = self.client.pull_summary(notebook_id)
            sync_record["status"] = "completed"
            sync_record["sources_transferred"] = 1
            sync_record["summary"] = summary

        except NotebookLMError as e:
            sync_record["status"] = "failed"
            sync_record["error"] = str(e)
            logger.error("Summary pull failed: %s", e)

        self._record_sync(sync_record)
        return sync_record

    # -- Bidirectional sync --

    def full_sync(
        self,
        notebook_id: str,
        push_events: Optional[list[dict]] = None,
        pull_source_type: Optional[str] = None,
    ) -> dict:
        """Perform a full bidirectional sync.

        1. Push any pending hook events to NotebookLM.
        2. Pull latest research context back.

        Args:
            notebook_id: Target/source notebook ID.
            push_events: Events to push (optional).
            pull_source_type: Filter for pull (optional).

        Returns:
            Combined sync result.
        """
        sync_id = str(uuid.uuid4())
        result = {
            "sync_id": sync_id,
            "direction": "bidirectional",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "push_result": None,
            "pull_result": None,
        }

        if push_events:
            result["push_result"] = self.push_batch(notebook_id, push_events)

        result["pull_result"] = self.pull_context(
            notebook_id,
            source_type=pull_source_type,
        )

        return result

    # -- Registry operations --

    def get_registry(self) -> dict:
        """Return the current registry state."""
        return dict(self._registry)

    def get_sync_history(self, limit: int = 50) -> list[dict]:
        """Return recent sync history from the registry."""
        history = self._registry.get("sync_history", [])
        return history[-limit:]

    def get_source_count(self) -> int:
        """Return total number of registered sources."""
        return len(self._registry.get("source_index", {}))

    def clear_registry(self) -> None:
        """Clear the registry (for testing/reset)."""
        self._registry = {
            "registry_version": "1.0.0",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "notebooks": [],
            "sync_history": [],
            "source_index": {},
        }
        self._save_registry()

    # -- Private helpers --

    def _create_sync_record(self, sync_id: str, direction: str) -> dict:
        """Create a new sync record."""
        return {
            "sync_id": sync_id,
            "direction": direction,
            "status": "in_progress",
            "sources_transferred": 0,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    def _is_duplicate(self, content_hash: str) -> bool:
        """Check if a content hash already exists in the registry."""
        return content_hash in self._registry.get("source_index", {})

    def _register_source(self, content_hash: str, source: dict) -> None:
        """Register a source in the source index."""
        if "source_index" not in self._registry:
            self._registry["source_index"] = {}
        self._registry["source_index"][content_hash] = {
            "source_id": source.get("source_id"),
            "source_type": source.get("source_type"),
            "registered_at": datetime.now(timezone.utc).isoformat(),
        }
        self._save_registry()

    def _record_sync(self, sync_record: dict) -> None:
        """Append a sync record to the registry history."""
        if "sync_history" not in self._registry:
            self._registry["sync_history"] = []
        self._registry["sync_history"].append(sync_record)
        # Keep history bounded
        if len(self._registry["sync_history"]) > 500:
            self._registry["sync_history"] = self._registry["sync_history"][-500:]
        self._save_registry()

    def _load_registry(self) -> dict:
        """Load registry from disk."""
        try:
            with open(self.registry_path) as f:
                return json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            return {
                "registry_version": "1.0.0",
                "created_at": datetime.now(timezone.utc).isoformat(),
                "notebooks": [],
                "sync_history": [],
                "source_index": {},
            }

    def _save_registry(self) -> None:
        """Persist registry to disk."""
        try:
            os.makedirs(os.path.dirname(self.registry_path), exist_ok=True)
            with open(self.registry_path, "w") as f:
                json.dump(self._registry, f, indent=2)
        except OSError as e:
            logger.error("Failed to save registry: %s", e)
