#!/usr/bin/env python3
"""Tests for main.py research sync tool."""

import asyncio
import json
import os
import tempfile
import unittest

from main import sync_query, async_query, export_results, KNOWLEDGE_BASE


class TestSyncQuery(unittest.TestCase):
    """Tests for sync_query function."""

    def test_hook_query_returns_hook_findings(self):
        results = sync_query("How do hooks work?")
        self.assertEqual(results["mode"], "sync")
        self.assertTrue(len(results["findings"]) >= 1)
        topics = [f["topic"] for f in results["findings"]]
        self.assertIn("Claude Code Hook System", topics)

    def test_notebooklm_query_returns_notebook_findings(self):
        results = sync_query("Tell me about NotebookLM integration")
        topics = [f["topic"] for f in results["findings"]]
        self.assertIn("NotebookLM Integration via Hooks", topics)

    def test_combined_query_returns_both(self):
        results = sync_query(
            "How does Claude Code's hook system enable two-way "
            "metadata exchange with NotebookLM?"
        )
        self.assertEqual(len(results["findings"]), 2)
        topics = [f["topic"] for f in results["findings"]]
        self.assertIn("Claude Code Hook System", topics)
        self.assertIn("NotebookLM Integration via Hooks", topics)

    def test_synthesis_generated_for_metadata_query(self):
        results = sync_query("hook two-way metadata exchange with NotebookLM")
        self.assertTrue(len(results["synthesis"]) > 0)
        self.assertIn("bidirectional", results["synthesis"].lower())

    def test_no_match_returns_fallback(self):
        results = sync_query("unrelated topic about cooking")
        self.assertEqual(results["findings"][0]["topic"], "No direct match")
        self.assertIn("Try refining", results["synthesis"])

    def test_result_has_required_fields(self):
        results = sync_query("hooks")
        self.assertIn("query", results)
        self.assertIn("mode", results)
        self.assertIn("timestamp", results)
        self.assertIn("findings", results)
        self.assertIn("synthesis", results)

    def test_timestamp_format(self):
        results = sync_query("hooks")
        self.assertTrue(results["timestamp"].endswith("Z"))

    def test_hook_types_present(self):
        results = sync_query("hook system")
        hook_finding = results["findings"][0]
        self.assertIn("hook_types", hook_finding)
        self.assertEqual(len(hook_finding["hook_types"]), 5)

    def test_metadata_exchange_keys(self):
        results = sync_query("hook system")
        exchange = results["findings"][0]["metadata_exchange"]
        self.assertIn("input", exchange)
        self.assertIn("output", exchange)
        self.assertIn("bidirectional_flow", exchange)

    def test_notebook_case_insensitive(self):
        results_lower = sync_query("notebook")
        results_upper = sync_query("NOTEBOOK")
        self.assertEqual(
            len(results_lower["findings"]),
            len(results_upper["findings"]),
        )


class TestAsyncQuery(unittest.TestCase):
    """Tests for async_query function."""

    def _run(self, coro):
        return asyncio.run(coro)

    def test_async_returns_correct_mode(self):
        results = self._run(async_query("hooks"))
        self.assertEqual(results["mode"], "async")

    def test_async_hook_query(self):
        results = self._run(async_query("hook system"))
        topics = [f["topic"] for f in results["findings"]]
        self.assertIn("Claude Code Hook System", topics)

    def test_async_notebooklm_query(self):
        results = self._run(async_query("NotebookLM"))
        topics = [f["topic"] for f in results["findings"]]
        self.assertIn("NotebookLM Integration via Hooks", topics)

    def test_async_combined_query(self):
        results = self._run(async_query(
            "hook metadata exchange with NotebookLM"
        ))
        self.assertEqual(len(results["findings"]), 2)

    def test_async_synthesis(self):
        results = self._run(async_query("two-way metadata exchange"))
        self.assertTrue(len(results["synthesis"]) > 0)

    def test_async_no_match(self):
        results = self._run(async_query("unrelated topic"))
        self.assertEqual(results["findings"][0]["topic"], "No direct match")

    def test_async_has_timestamp(self):
        results = self._run(async_query("hooks"))
        self.assertTrue(results["timestamp"].endswith("Z"))


class TestExportResults(unittest.TestCase):
    """Tests for export_results function."""

    def test_export_creates_file(self):
        with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as f:
            path = f.name
        try:
            result_path = export_results("hooks", output_path=path)
            self.assertEqual(result_path, path)
            self.assertTrue(os.path.exists(path))
        finally:
            os.unlink(path)

    def test_export_valid_json(self):
        with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as f:
            path = f.name
        try:
            export_results("hook system", output_path=path)
            with open(path) as f:
                data = json.load(f)
            self.assertEqual(data["mode"], "export")
            self.assertIn("findings", data)
        finally:
            os.unlink(path)

    def test_export_default_path(self):
        path = export_results("hooks")
        try:
            self.assertTrue(path.startswith("export_"))
            self.assertTrue(path.endswith(".json"))
            self.assertTrue(os.path.exists(path))
        finally:
            os.unlink(path)

    def test_export_contains_query(self):
        with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as f:
            path = f.name
        try:
            export_results("NotebookLM integration", output_path=path)
            with open(path) as f:
                data = json.load(f)
            self.assertEqual(data["query"], "NotebookLM integration")
        finally:
            os.unlink(path)


class TestKnowledgeBase(unittest.TestCase):
    """Tests for knowledge base structure."""

    def test_has_hook_system(self):
        self.assertIn("hook_system", KNOWLEDGE_BASE)

    def test_has_notebooklm_integration(self):
        self.assertIn("notebooklm_integration", KNOWLEDGE_BASE)

    def test_hook_system_has_required_keys(self):
        hs = KNOWLEDGE_BASE["hook_system"]
        self.assertIn("title", hs)
        self.assertIn("description", hs)
        self.assertIn("hook_types", hs)
        self.assertIn("metadata_exchange", hs)

    def test_notebooklm_has_required_keys(self):
        nb = KNOWLEDGE_BASE["notebooklm_integration"]
        self.assertIn("title", nb)
        self.assertIn("description", nb)
        self.assertIn("how_it_works", nb)
        self.assertIn("metadata_types", nb)


if __name__ == "__main__":
    unittest.main()
