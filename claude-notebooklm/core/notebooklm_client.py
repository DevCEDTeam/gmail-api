"""NotebookLM push and pull client.

Handles uploading Claude Code sources to NotebookLM notebooks
and retrieving research context back for injection into sessions.
"""

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

import requests

logger = logging.getLogger(__name__)

DEFAULT_BASE_URL = "https://notebooklm.googleapis.com/v1"


class NotebookLMError(Exception):
    """Base exception for NotebookLM client errors."""


class AuthenticationError(NotebookLMError):
    """Raised when authentication with NotebookLM fails."""


class NotebookNotFoundError(NotebookLMError):
    """Raised when a referenced notebook does not exist."""


class SourceUploadError(NotebookLMError):
    """Raised when a source upload fails."""


class NotebookLMClient:
    """Client for interacting with NotebookLM's API.

    Supports pushing Claude Code sources as notebook entries
    and pulling research context for session enrichment.
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: str = DEFAULT_BASE_URL,
        timeout: int = 30,
    ):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self._session = requests.Session()
        if api_key:
            self._session.headers["Authorization"] = f"Bearer {api_key}"
        self._session.headers["Content-Type"] = "application/json"

    # -- Notebook operations --

    def list_notebooks(self) -> list[dict]:
        """List all available notebooks."""
        return self._request("GET", "/notebooks")

    def get_notebook(self, notebook_id: str) -> dict:
        """Get a notebook by ID."""
        if not notebook_id:
            raise ValueError("notebook_id is required")
        result = self._request("GET", f"/notebooks/{notebook_id}")
        if result is None:
            raise NotebookNotFoundError(f"Notebook {notebook_id} not found")
        return result

    def create_notebook(self, title: str) -> dict:
        """Create a new notebook."""
        if not title or not title.strip():
            raise ValueError("title is required")
        payload = {
            "title": title.strip(),
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        return self._request("POST", "/notebooks", payload)

    # -- Source push operations --

    def push_source(
        self,
        notebook_id: str,
        source_type: str,
        title: str,
        content: str,
        metadata: Optional[dict] = None,
    ) -> dict:
        """Push a single source to a NotebookLM notebook.

        Args:
            notebook_id: Target notebook ID.
            source_type: One of the 6 Claude Code source types.
            title: Human-readable title for the source.
            content: Full text content.
            metadata: Optional metadata (session_id, tags, etc.).

        Returns:
            Created source record with assigned source_id.
        """
        valid_types = {
            "hook_event", "session_transcript", "code_diff",
            "tool_invocation", "reasoning_trace", "architecture_note",
        }
        if source_type not in valid_types:
            raise ValueError(
                f"Invalid source_type '{source_type}'. "
                f"Must be one of: {', '.join(sorted(valid_types))}"
            )
        if not content or not content.strip():
            raise ValueError("content cannot be empty")
        if not title or not title.strip():
            raise ValueError("title cannot be empty")

        source_entry = {
            "source_id": str(uuid.uuid4()),
            "source_type": source_type,
            "title": title.strip(),
            "content": content.strip(),
            "metadata": metadata or {},
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

        result = self._request(
            "POST",
            f"/notebooks/{notebook_id}/sources",
            source_entry,
        )
        if result is None:
            raise SourceUploadError(
                f"Failed to push source to notebook {notebook_id}"
            )
        return {**source_entry, **result} if isinstance(result, dict) else source_entry

    def push_sources_batch(
        self,
        notebook_id: str,
        sources: list[dict],
    ) -> list[dict]:
        """Push multiple sources in a single batch.

        Args:
            notebook_id: Target notebook ID.
            sources: List of source dicts, each with source_type, title, content.

        Returns:
            List of created source records.
        """
        if not sources:
            return []

        results = []
        for source in sources:
            result = self.push_source(
                notebook_id=notebook_id,
                source_type=source["source_type"],
                title=source["title"],
                content=source["content"],
                metadata=source.get("metadata"),
            )
            results.append(result)
        return results

    # -- Source pull operations --

    def pull_sources(
        self,
        notebook_id: str,
        source_type: Optional[str] = None,
        since: Optional[str] = None,
        limit: int = 50,
    ) -> list[dict]:
        """Pull sources from a NotebookLM notebook.

        Args:
            notebook_id: Source notebook ID.
            source_type: Optional filter by source type.
            since: Optional ISO timestamp to fetch only newer sources.
            limit: Maximum number of sources to return.

        Returns:
            List of source entries.
        """
        params = {"limit": min(limit, 100)}
        if source_type:
            params["source_type"] = source_type
        if since:
            params["since"] = since

        result = self._request(
            "GET",
            f"/notebooks/{notebook_id}/sources",
            params=params,
        )
        return result if isinstance(result, list) else []

    def pull_summary(self, notebook_id: str) -> dict:
        """Pull the AI-generated summary/overview from a notebook.

        Returns:
            Summary dict with 'text' and 'generated_at' fields.
        """
        return self._request("GET", f"/notebooks/{notebook_id}/summary")

    # -- Internal request handler --

    def _request(
        self,
        method: str,
        path: str,
        payload: Optional[dict] = None,
        params: Optional[dict] = None,
    ) -> Optional[dict | list]:
        """Make an HTTP request to the NotebookLM API."""
        url = f"{self.base_url}{path}"
        try:
            response = self._session.request(
                method=method,
                url=url,
                json=payload if method in ("POST", "PUT", "PATCH") else None,
                params=params,
                timeout=self.timeout,
            )
            if response.status_code == 401:
                raise AuthenticationError("Invalid or expired API key")
            if response.status_code == 404:
                raise NotebookNotFoundError(f"Resource not found: {path}")
            response.raise_for_status()
            return response.json()
        except requests.ConnectionError as e:
            logger.warning("NotebookLM API connection failed: %s", e)
            raise NotebookLMError(f"Connection failed: {e}") from e
        except requests.Timeout as e:
            logger.warning("NotebookLM API request timed out: %s", e)
            raise NotebookLMError(f"Request timed out: {e}") from e
        except requests.HTTPError as e:
            logger.error("NotebookLM API error: %s", e)
            raise NotebookLMError(f"API error: {e}") from e


def create_client(
    api_key: Optional[str] = None,
    base_url: str = DEFAULT_BASE_URL,
) -> NotebookLMClient:
    """Factory function to create a configured NotebookLM client."""
    return NotebookLMClient(api_key=api_key, base_url=base_url)
