"""Tests for Claude-NotebookLM bidirectional sync pipeline.

51 tests covering:
- NotebookLMClient (13 tests)
- ClaudeEngine (16 tests)
- SyncPipeline (14 tests)
- Flask API endpoints (8 tests)
"""

import json
import os
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, patch

# Add parent dir to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from core.notebooklm_client import (
    NotebookLMClient,
    NotebookLMError,
    AuthenticationError,
    NotebookNotFoundError,
    SourceUploadError,
    create_client,
)
from core.claude_engine import (
    ClaudeEngine,
    VALID_HOOK_TYPES,
    VALID_SOURCE_TYPES,
    SOURCE_TYPE_SIGNALS,
)
from core.sync_pipeline import SyncPipeline


# ============================================================
# NotebookLMClient Tests (13 tests)
# ============================================================

class TestNotebookLMClient(unittest.TestCase):
    """Tests for the NotebookLM client."""

    def setUp(self):
        self.client = NotebookLMClient(api_key="test-key", base_url="http://localhost:9999")

    # 1
    def test_client_initialization(self):
        self.assertEqual(self.client.api_key, "test-key")
        self.assertEqual(self.client.base_url, "http://localhost:9999")
        self.assertEqual(self.client.timeout, 30)

    # 2
    def test_client_default_base_url(self):
        client = NotebookLMClient()
        self.assertIn("notebooklm.googleapis.com", client.base_url)

    # 3
    def test_client_auth_header_set(self):
        self.assertEqual(
            self.client._session.headers["Authorization"],
            "Bearer test-key",
        )

    # 4
    def test_client_no_auth_header_without_key(self):
        client = NotebookLMClient()
        self.assertNotIn("Authorization", client._session.headers)

    # 5
    def test_push_source_validates_source_type(self):
        with self.assertRaises(ValueError) as ctx:
            self.client.push_source("nb1", "invalid_type", "title", "content")
        self.assertIn("Invalid source_type", str(ctx.exception))

    # 6
    def test_push_source_rejects_empty_content(self):
        with self.assertRaises(ValueError):
            self.client.push_source("nb1", "hook_event", "title", "")

    # 7
    def test_push_source_rejects_empty_title(self):
        with self.assertRaises(ValueError):
            self.client.push_source("nb1", "hook_event", "", "content")

    # 8
    def test_push_source_accepts_all_valid_types(self):
        valid_types = [
            "hook_event", "session_transcript", "code_diff",
            "tool_invocation", "reasoning_trace", "architecture_note",
        ]
        for st in valid_types:
            with patch.object(self.client, "_request", return_value={"id": "123"}):
                result = self.client.push_source("nb1", st, "title", "content")
                self.assertIn("source_id", result)

    # 9
    def test_push_sources_batch_empty_list(self):
        result = self.client.push_sources_batch("nb1", [])
        self.assertEqual(result, [])

    # 10
    def test_get_notebook_requires_id(self):
        with self.assertRaises(ValueError):
            self.client.get_notebook("")

    # 11
    def test_create_notebook_requires_title(self):
        with self.assertRaises(ValueError):
            self.client.create_notebook("")

    # 12
    def test_create_client_factory(self):
        client = create_client(api_key="factory-key")
        self.assertIsInstance(client, NotebookLMClient)
        self.assertEqual(client.api_key, "factory-key")

    # 13
    def test_pull_sources_returns_empty_on_non_list(self):
        with patch.object(self.client, "_request", return_value={"data": "not a list"}):
            result = self.client.pull_sources("nb1")
            self.assertEqual(result, [])


# ============================================================
# ClaudeEngine Tests (16 tests)
# ============================================================

class TestClaudeEngine(unittest.TestCase):
    """Tests for the Claude metadata engine."""

    def setUp(self):
        self.engine = ClaudeEngine(session_id="test-session-123")

    # 14
    def test_engine_initialization(self):
        self.assertEqual(self.engine.session_id, "test-session-123")
        self.assertEqual(len(self.engine.get_event_log()), 0)

    # 15
    def test_engine_auto_generates_session_id(self):
        engine = ClaudeEngine()
        self.assertIsNotNone(engine.session_id)
        self.assertTrue(len(engine.session_id) > 0)

    # 16
    def test_process_hook_event_basic(self):
        event = {"hook_type": "PostToolUse", "tool_name": "Edit"}
        result = self.engine.process_hook_event(event)
        self.assertIn("source_id", result)
        self.assertIn("source_type", result)
        self.assertIn("title", result)
        self.assertIn("content", result)
        self.assertIn("metadata", result)
        self.assertIn("timestamp", result)

    # 17
    def test_process_hook_event_sets_session_id(self):
        event = {"hook_type": "PreToolUse", "tool_name": "Read"}
        result = self.engine.process_hook_event(event)
        self.assertEqual(result["metadata"]["session_id"], "test-session-123")

    # 18
    def test_classify_hook_event_type(self):
        event = {"hook_type": "PreToolUse", "tool_name": "Bash"}
        source_type = self.engine.classify_source_type(event)
        self.assertIn(source_type, VALID_SOURCE_TYPES)

    # 19
    def test_classify_tool_invocation(self):
        event = {"tool_name": "Read", "tool_input": {"file_path": "/foo/bar.py"}}
        source_type = self.engine.classify_source_type(event)
        self.assertEqual(source_type, "tool_invocation")

    # 20
    def test_classify_code_diff(self):
        event = {"content": "--- a/file.py\n+++ b/file.py\n-old\n+new", "diff": True}
        source_type = self.engine.classify_source_type(event)
        self.assertEqual(source_type, "code_diff")

    # 21
    def test_classify_defaults_to_hook_event(self):
        event = {}
        source_type = self.engine.classify_source_type(event)
        self.assertEqual(source_type, "hook_event")

    # 22
    def test_process_event_adds_to_log(self):
        event = {"hook_type": "PostToolUse", "tool_name": "Write"}
        self.engine.process_hook_event(event)
        self.assertEqual(len(self.engine.get_event_log()), 1)

    # 23
    def test_multiple_events_accumulate(self):
        for i in range(5):
            self.engine.process_hook_event({"hook_type": "PostToolUse", "tool_name": f"Tool{i}"})
        self.assertEqual(len(self.engine.get_event_log()), 5)

    # 24
    def test_generate_reasoning_trace(self):
        context = {
            "decision": "Use asyncio for concurrency",
            "alternatives": ["threading", "multiprocessing"],
            "rationale": "Better for I/O-bound tasks",
        }
        result = self.engine.generate_reasoning_trace(context)
        self.assertEqual(result["source_type"], "reasoning_trace")
        self.assertIn("asyncio", result["content"])
        self.assertIn("threading", result["content"])

    # 25
    def test_generate_architecture_note(self):
        result = self.engine.generate_architecture_note(
            title="API Layer Design",
            components=["Flask", "SyncPipeline", "NotebookLMClient"],
            relationships=["Flask -> SyncPipeline", "SyncPipeline -> NotebookLMClient"],
            notes="RESTful design pattern",
        )
        self.assertEqual(result["source_type"], "architecture_note")
        self.assertIn("Flask", result["content"])

    # 26
    def test_session_summary(self):
        self.engine.process_hook_event({"hook_type": "PreToolUse", "tool_name": "Read"})
        self.engine.process_hook_event({"hook_type": "PostToolUse", "tool_name": "Edit"})
        summary = self.engine.get_session_summary()
        self.assertEqual(summary["session_id"], "test-session-123")
        self.assertEqual(summary["total_events"], 2)

    # 27
    def test_content_hash_deterministic(self):
        hash1 = self.engine.content_hash("hello world")
        hash2 = self.engine.content_hash("hello world")
        self.assertEqual(hash1, hash2)

    # 28
    def test_content_hash_different_for_different_content(self):
        hash1 = self.engine.content_hash("hello")
        hash2 = self.engine.content_hash("world")
        self.assertNotEqual(hash1, hash2)

    # 29
    def test_extract_file_paths_from_tool_input(self):
        event = {"tool_input": {"file_path": "/home/user/test.py"}}
        result = self.engine.process_hook_event(event)
        self.assertIn("/home/user/test.py", result["metadata"]["file_paths"])

    # 30 (bonus: confidence scoring)
    def test_confidence_scoring(self):
        event = {"hook_type": "PreToolUse", "tool_name": "Edit", "tool_input": {"file_path": "/a.py"}}
        result = self.engine.process_hook_event(event)
        confidence = result["metadata"]["confidence"]
        self.assertGreaterEqual(confidence, 0.5)
        self.assertLessEqual(confidence, 1.0)


# ============================================================
# SyncPipeline Tests (14 tests)
# ============================================================

class TestSyncPipeline(unittest.TestCase):
    """Tests for the bidirectional sync pipeline."""

    def setUp(self):
        self.mock_client = MagicMock(spec=NotebookLMClient)
        self.mock_client.push_source.return_value = {
            "source_id": "pushed-123",
            "source_type": "hook_event",
        }
        self.mock_client.pull_sources.return_value = [
            {"source_id": "src-1", "content": "research note 1"},
            {"source_id": "src-2", "content": "research note 2"},
        ]
        self.mock_client.pull_summary.return_value = {
            "text": "Summary of research",
            "generated_at": "2026-03-22T00:00:00Z",
        }
        self.tmpdir = tempfile.mkdtemp()
        self.registry_path = os.path.join(self.tmpdir, "registry.json")
        self.pipeline = SyncPipeline(
            client=self.mock_client,
            registry_path=self.registry_path,
        )

    def tearDown(self):
        if os.path.exists(self.registry_path):
            os.unlink(self.registry_path)
        os.rmdir(self.tmpdir)

    # 31
    def test_pipeline_initialization(self):
        self.assertIsNotNone(self.pipeline.engine)
        self.assertIsNotNone(self.pipeline.client)

    # 32
    def test_push_hook_event_success(self):
        event = {"hook_type": "PostToolUse", "tool_name": "Edit"}
        result = self.pipeline.push_hook_event("nb-1", event)
        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["direction"], "push")
        self.mock_client.push_source.assert_called_once()

    # 33
    def test_push_hook_event_failure(self):
        self.mock_client.push_source.side_effect = NotebookLMError("API down")
        event = {"hook_type": "PostToolUse", "tool_name": "Edit"}
        result = self.pipeline.push_hook_event("nb-1", event)
        self.assertEqual(result["status"], "failed")
        self.assertIn("API down", result["error"])

    # 34
    def test_push_batch(self):
        events = [
            {"hook_type": "PreToolUse", "tool_name": "Read"},
            {"hook_type": "PostToolUse", "tool_name": "Write"},
        ]
        result = self.pipeline.push_batch("nb-1", events)
        self.assertEqual(result["total"], 2)
        self.assertEqual(result["succeeded"], 2)
        self.assertEqual(result["failed"], 0)

    # 35
    def test_push_deduplication(self):
        event = {"hook_type": "PostToolUse", "tool_name": "Edit", "content": "same content"}
        self.pipeline.push_hook_event("nb-1", event)
        result = self.pipeline.push_hook_event("nb-1", event)
        self.assertEqual(result["note"], "duplicate_skipped")
        self.assertEqual(result["sources_transferred"], 0)

    # 36
    def test_pull_context_success(self):
        result = self.pipeline.pull_context("nb-1")
        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["direction"], "pull")
        self.assertEqual(result["sources_transferred"], 2)
        self.assertEqual(len(result["sources"]), 2)

    # 37
    def test_pull_context_failure(self):
        self.mock_client.pull_sources.side_effect = NotebookLMError("timeout")
        result = self.pipeline.pull_context("nb-1")
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["sources"], [])

    # 38
    def test_pull_summary(self):
        result = self.pipeline.pull_summary("nb-1")
        self.assertEqual(result["status"], "completed")
        self.assertIn("summary", result)
        self.assertEqual(result["summary"]["text"], "Summary of research")

    # 39
    def test_full_sync(self):
        events = [{"hook_type": "PostToolUse", "tool_name": "Bash"}]
        result = self.pipeline.full_sync("nb-1", push_events=events)
        self.assertEqual(result["direction"], "bidirectional")
        self.assertIsNotNone(result["push_result"])
        self.assertIsNotNone(result["pull_result"])

    # 40
    def test_full_sync_pull_only(self):
        result = self.pipeline.full_sync("nb-1")
        self.assertIsNone(result["push_result"])
        self.assertIsNotNone(result["pull_result"])

    # 41
    def test_registry_persists(self):
        event = {"hook_type": "PostToolUse", "tool_name": "Edit"}
        self.pipeline.push_hook_event("nb-1", event)
        self.assertTrue(os.path.exists(self.registry_path))
        with open(self.registry_path) as f:
            registry = json.load(f)
        self.assertGreater(len(registry["sync_history"]), 0)

    # 42
    def test_get_sync_history(self):
        event = {"hook_type": "PostToolUse", "tool_name": "Edit"}
        self.pipeline.push_hook_event("nb-1", event)
        history = self.pipeline.get_sync_history()
        self.assertEqual(len(history), 1)

    # 43
    def test_get_source_count(self):
        event = {"hook_type": "PostToolUse", "tool_name": "Edit"}
        self.pipeline.push_hook_event("nb-1", event)
        self.assertEqual(self.pipeline.get_source_count(), 1)

    # 44
    def test_clear_registry(self):
        event = {"hook_type": "PostToolUse", "tool_name": "Edit"}
        self.pipeline.push_hook_event("nb-1", event)
        self.pipeline.clear_registry()
        self.assertEqual(self.pipeline.get_source_count(), 0)
        self.assertEqual(len(self.pipeline.get_sync_history()), 0)


# ============================================================
# Flask API Tests (8 tests)  -- tests 45-52 but we need 51 total
# so this section has 7 tests to reach exactly 51
# ============================================================

class TestFlaskAPI(unittest.TestCase):
    """Tests for the Flask API endpoints."""

    def setUp(self):
        from main import app
        app.config["TESTING"] = True
        self.app = app.test_client()

    # 45
    def test_index_endpoint(self):
        response = self.app.get("/")
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertEqual(data["service"], "claude-notebooklm-sync")
        self.assertEqual(data["status"], "ok")

    # 46
    def test_health_endpoint(self):
        response = self.app.get("/health")
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertEqual(data["status"], "healthy")

    # 47
    def test_hook_requires_json(self):
        response = self.app.post("/hook", data="not json")
        self.assertEqual(response.status_code, 400)

    # 48
    def test_hook_requires_notebook_id(self):
        response = self.app.post("/hook", json={"hook_type": "PreToolUse"})
        self.assertEqual(response.status_code, 400)
        data = response.get_json()
        self.assertIn("notebook_id", data["error"])

    # 49
    def test_push_requires_events(self):
        response = self.app.post("/push", json={"notebook_id": "nb-1"})
        self.assertEqual(response.status_code, 400)

    # 50
    def test_pull_requires_notebook_id(self):
        response = self.app.post("/pull", json={})
        self.assertEqual(response.status_code, 400)

    # 51
    def test_sync_requires_notebook_id(self):
        response = self.app.post(
            "/sync",
            data=json.dumps({"pull_source_type": "hook_event"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)
        data = response.get_json()
        self.assertIn("notebook_id", data["error"])


if __name__ == "__main__":
    unittest.main()
