"""Claude metadata generator and reasoner.

Processes Claude Code hook events into structured metadata entries
suitable for NotebookLM ingestion. Handles classification, enrichment,
and confidence scoring of session artifacts.
"""

import hashlib
import json
import re
import uuid
from datetime import datetime, timezone
from typing import Optional


# Source type classification keywords
SOURCE_TYPE_SIGNALS = {
    "hook_event": {"hook", "PreToolUse", "PostToolUse", "SessionStart", "SessionStop", "Notification"},
    "session_transcript": {"conversation", "transcript", "dialog", "session", "message"},
    "code_diff": {"diff", "patch", "change", "modified", "added", "deleted", "+++", "---"},
    "tool_invocation": {"Read", "Write", "Edit", "Bash", "Grep", "Glob", "tool_name", "tool_input"},
    "reasoning_trace": {"because", "therefore", "reasoning", "decision", "approach", "strategy", "consider"},
    "architecture_note": {"architecture", "design", "component", "module", "dependency", "structure", "pattern"},
}

VALID_HOOK_TYPES = {"PreToolUse", "PostToolUse", "Notification", "SessionStart", "SessionStop"}

VALID_SOURCE_TYPES = {
    "hook_event", "session_transcript", "code_diff",
    "tool_invocation", "reasoning_trace", "architecture_note",
}


DEFAULT_MODEL = "claude-opus-4-6"


class ClaudeEngine:
    """Generates structured metadata from Claude Code hook events."""

    def __init__(self, session_id: Optional[str] = None, model: Optional[str] = None):
        self.session_id = session_id or str(uuid.uuid4())
        self.model = model or DEFAULT_MODEL
        self._event_log: list[dict] = []

    def process_hook_event(self, event: dict) -> dict:
        """Process a raw hook event into a structured metadata entry.

        Args:
            event: Raw hook event dict from Claude Code (received on stdin).

        Returns:
            Structured source entry ready for NotebookLM push.
        """
        hook_type = event.get("hook_type", "")
        tool_name = event.get("tool_name", "")
        tool_input = event.get("tool_input", {})

        source_type = self.classify_source_type(event)
        title = self._generate_title(hook_type, tool_name, source_type)
        content = self._generate_content(event)
        confidence = self._compute_confidence(event, source_type)
        file_paths = self._extract_file_paths(event)
        tags = self._generate_tags(event, source_type)

        c_hash = self.content_hash(content)
        summary = self._generate_summary(content, source_type)

        entry = {
            "source_id": str(uuid.uuid4()),
            "source_type": source_type,
            "title": title,
            "content": content,
            "metadata": {
                "session_id": self.session_id,
                "hook_type": hook_type if hook_type in VALID_HOOK_TYPES else None,
                "tool_name": tool_name or None,
                "file_paths": file_paths,
                "tags": tags,
                "confidence": confidence,
                "model": self.model,
                "content_hash": c_hash,
                "summary": summary,
            },
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

        self._event_log.append(entry)
        return entry

    def classify_source_type(self, event: dict) -> str:
        """Classify the source type of a hook event based on content signals.

        Args:
            event: Raw hook event dict.

        Returns:
            One of the 6 valid source types.
        """
        event_text = json.dumps(event).lower()
        scores: dict[str, int] = {}

        for source_type, signals in SOURCE_TYPE_SIGNALS.items():
            score = sum(1 for signal in signals if signal.lower() in event_text)
            scores[source_type] = score

        # Direct hook_type mapping takes priority
        hook_type = event.get("hook_type", "")
        if hook_type in VALID_HOOK_TYPES:
            scores["hook_event"] = scores.get("hook_event", 0) + 3

        # Tool invocation detection
        tool_name = event.get("tool_name", "")
        if tool_name:
            scores["tool_invocation"] = scores.get("tool_invocation", 0) + 2

        best = max(scores, key=lambda k: scores[k]) if scores else "hook_event"
        return best if scores.get(best, 0) > 0 else "hook_event"

    def generate_reasoning_trace(self, context: dict) -> dict:
        """Generate a reasoning trace entry from decision context.

        Args:
            context: Dict with 'decision', 'alternatives', 'rationale' keys.

        Returns:
            Structured reasoning trace source entry.
        """
        decision = context.get("decision", "")
        alternatives = context.get("alternatives", [])
        rationale = context.get("rationale", "")

        content_parts = [f"Decision: {decision}"]
        if alternatives:
            content_parts.append(f"Alternatives considered: {', '.join(alternatives)}")
        if rationale:
            content_parts.append(f"Rationale: {rationale}")

        content = "\n".join(content_parts)
        entry = {
            "source_id": str(uuid.uuid4()),
            "source_type": "reasoning_trace",
            "title": f"Decision: {decision[:80]}" if decision else "Reasoning trace",
            "content": content,
            "metadata": {
                "session_id": self.session_id,
                "hook_type": None,
                "tool_name": None,
                "file_paths": [],
                "tags": ["reasoning", "decision"],
                "confidence": 0.9,
                "model": self.model,
                "content_hash": self.content_hash(content),
                "summary": self._generate_summary(content, "reasoning_trace"),
            },
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

        self._event_log.append(entry)
        return entry

    def generate_architecture_note(
        self,
        title: str,
        components: list[str],
        relationships: Optional[list[str]] = None,
        notes: str = "",
    ) -> dict:
        """Generate an architecture note from structural observations.

        Args:
            title: Title of the architecture observation.
            components: List of components/modules identified.
            relationships: Optional list of component relationships.
            notes: Additional notes.

        Returns:
            Structured architecture note source entry.
        """
        content_parts = [f"Components: {', '.join(components)}"]
        if relationships:
            content_parts.append(f"Relationships: {'; '.join(relationships)}")
        if notes:
            content_parts.append(f"Notes: {notes}")

        content = "\n".join(content_parts)
        entry = {
            "source_id": str(uuid.uuid4()),
            "source_type": "architecture_note",
            "title": title[:200],
            "content": content,
            "metadata": {
                "session_id": self.session_id,
                "hook_type": None,
                "tool_name": None,
                "file_paths": [],
                "tags": ["architecture"] + [c.lower().replace(" ", "_") for c in components[:5]],
                "confidence": 0.85,
                "model": self.model,
                "content_hash": self.content_hash(content),
                "summary": self._generate_summary(content, "architecture_note"),
            },
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

        self._event_log.append(entry)
        return entry

    def get_event_log(self) -> list[dict]:
        """Return the full event log for the current session."""
        return list(self._event_log)

    def get_session_summary(self) -> dict:
        """Generate a summary of the current session's metadata."""
        type_counts: dict[str, int] = {}
        for entry in self._event_log:
            st = entry.get("source_type", "unknown")
            type_counts[st] = type_counts.get(st, 0) + 1

        return {
            "session_id": self.session_id,
            "total_events": len(self._event_log),
            "source_type_counts": type_counts,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    def enrich_sources(self, sources: list[dict]) -> list[dict]:
        """Enrich pulled sources with Claude analysis.

        Takes raw sources from NotebookLM and produces enriched entries
        (reasoning traces / architecture notes) that can be pushed back,
        completing the knowledge loop.

        Args:
            sources: Raw source entries pulled from NotebookLM.

        Returns:
            List of new enriched source entries ready to push back.
        """
        enriched = []
        for source in sources:
            content = source.get("content", "")
            title = source.get("title", "")
            source_type = source.get("source_type", "")

            if not content:
                continue

            # Generate a reasoning trace that synthesizes the source
            synthesis = (
                f"Enrichment of: {title}\n"
                f"Original type: {source_type}\n"
                f"Analysis: {self._summarize_text(content)}\n"
                f"Enriched by: {self.model}"
            )

            entry = {
                "source_id": str(uuid.uuid4()),
                "source_type": "reasoning_trace",
                "title": f"Enrichment: {title[:150]}",
                "content": synthesis,
                "metadata": {
                    "session_id": self.session_id,
                    "hook_type": None,
                    "tool_name": None,
                    "file_paths": [],
                    "tags": ["enrichment", "synthesis", source_type] if source_type else ["enrichment", "synthesis"],
                    "confidence": 0.85,
                    "model": self.model,
                    "content_hash": self.content_hash(synthesis),
                    "summary": self._generate_summary(synthesis, "reasoning_trace"),
                    "enriched_from": source.get("source_id"),
                },
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
            enriched.append(entry)
            self._event_log.append(entry)

        return enriched

    def ground_query(self, query: str, sources: list[dict]) -> dict:
        """Ground a query against pulled NotebookLM sources.

        Searches sources for relevance, extracts citations, and
        synthesizes a grounded answer.

        Args:
            query: The question to answer.
            sources: Source entries from NotebookLM to search against.

        Returns:
            Grounded response with answer, citations, and source references.
        """
        query_lower = query.lower()
        query_terms = set(query_lower.split())

        scored_sources = []
        for source in sources:
            content = source.get("content", "").lower()
            title = source.get("title", "").lower()
            text = f"{title} {content}"

            # Score by term overlap
            matches = sum(1 for term in query_terms if term in text)
            relevance = matches / max(len(query_terms), 1)

            if relevance > 0:
                scored_sources.append((source, relevance))

        # Sort by relevance descending
        scored_sources.sort(key=lambda x: x[1], reverse=True)
        top_sources = scored_sources[:5]

        # Build citations
        citations = []
        for source, relevance in top_sources:
            content = source.get("content", "")
            excerpt = content[:200] + "..." if len(content) > 200 else content
            citations.append({
                "source_id": source.get("source_id", ""),
                "title": source.get("title", ""),
                "excerpt": excerpt,
                "relevance": round(relevance, 3),
            })

        # Synthesize answer from top sources
        if citations:
            answer_parts = [f"Based on {len(citations)} source(s):"]
            for cit in citations:
                answer_parts.append(f"- [{cit['title']}]: {cit['excerpt']}")
            answer = "\n".join(answer_parts)
        else:
            answer = "No relevant sources found for this query."

        return {
            "answer": answer,
            "citations": citations,
            "source_count": len(citations),
            "query": query,
            "model": self.model,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    def content_hash(self, content: str) -> str:
        """Generate a deterministic hash for content deduplication."""
        return hashlib.sha256(content.encode("utf-8")).hexdigest()[:16]

    # -- Private helpers --

    def _generate_summary(self, content: str, source_type: str) -> str:
        """Generate a concise summary of the content."""
        return self._summarize_text(content)

    def _summarize_text(self, text: str, max_length: int = 150) -> str:
        """Create a truncated summary from text content."""
        # Take first meaningful line(s) up to max_length
        lines = [line.strip() for line in text.strip().split("\n") if line.strip()]
        summary = ""
        for line in lines:
            if len(summary) + len(line) + 2 > max_length:
                break
            summary = f"{summary}; {line}" if summary else line
        return summary or text[:max_length]

    def _generate_title(self, hook_type: str, tool_name: str, source_type: str) -> str:
        """Generate a human-readable title for the source entry."""
        if hook_type and tool_name:
            return f"{hook_type}: {tool_name}"
        if hook_type:
            return f"Hook event: {hook_type}"
        if tool_name:
            return f"Tool: {tool_name}"
        return f"Source: {source_type.replace('_', ' ').title()}"

    def _generate_content(self, event: dict) -> str:
        """Serialize event data into readable content."""
        parts = []

        if event.get("hook_type"):
            parts.append(f"Hook Type: {event['hook_type']}")
        if event.get("tool_name"):
            parts.append(f"Tool: {event['tool_name']}")
        if event.get("tool_input"):
            tool_input = event["tool_input"]
            if isinstance(tool_input, dict):
                for key, value in tool_input.items():
                    val_str = str(value)
                    if len(val_str) > 500:
                        val_str = val_str[:500] + "..."
                    parts.append(f"  {key}: {val_str}")
            else:
                parts.append(f"  Input: {str(tool_input)[:500]}")
        if event.get("tool_output"):
            output = str(event["tool_output"])
            if len(output) > 1000:
                output = output[:1000] + "..."
            parts.append(f"Output: {output}")
        if event.get("description"):
            parts.append(f"Description: {event['description']}")

        return "\n".join(parts) if parts else json.dumps(event, indent=2)

    def _compute_confidence(self, event: dict, source_type: str) -> float:
        """Compute a confidence score for the classification."""
        score = 0.5

        # Boost for explicit hook type
        if event.get("hook_type") in VALID_HOOK_TYPES:
            score += 0.2

        # Boost for tool name presence
        if event.get("tool_name"):
            score += 0.1

        # Boost for content richness
        content_length = len(json.dumps(event))
        if content_length > 200:
            score += 0.1
        if content_length > 500:
            score += 0.1

        return min(score, 1.0)

    def _extract_file_paths(self, event: dict) -> list[str]:
        """Extract file paths from event data."""
        paths = []
        event_str = json.dumps(event)

        # Match common file path patterns
        pattern = r'(?:/[\w.-]+)+(?:\.\w+)'
        matches = re.findall(pattern, event_str)
        paths.extend(matches)

        # Check tool_input for explicit file_path
        tool_input = event.get("tool_input", {})
        if isinstance(tool_input, dict):
            if "file_path" in tool_input:
                paths.append(tool_input["file_path"])
            if "path" in tool_input:
                paths.append(tool_input["path"])

        return list(dict.fromkeys(paths))  # deduplicate preserving order

    def _generate_tags(self, event: dict, source_type: str) -> list[str]:
        """Generate descriptive tags for the source entry."""
        tags = [source_type]

        hook_type = event.get("hook_type", "")
        if hook_type:
            tags.append(hook_type.lower())

        tool_name = event.get("tool_name", "")
        if tool_name:
            tags.append(tool_name.lower())

        return tags
