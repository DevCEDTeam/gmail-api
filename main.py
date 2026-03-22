#!/usr/bin/env python3
"""Research sync tool for Claude Code hook system analysis."""

import argparse
import asyncio
import json
import os
import textwrap
from datetime import datetime


KNOWLEDGE_BASE = {
    "hook_system": {
        "title": "Claude Code Hook System",
        "description": (
            "Claude Code's hook system allows users to define shell commands "
            "that execute automatically in response to specific events during "
            "a coding session. Hooks are configured in settings.json and run "
            "as subprocesses, enabling pre/post processing around tool calls."
        ),
        "hook_types": [
            "PreToolUse - Runs before a tool executes (can block or modify)",
            "PostToolUse - Runs after a tool completes (can process results)",
            "Notification - Runs when Claude Code emits a notification",
            "SessionStart - Runs when a new session begins",
            "SessionStop - Runs when a session ends",
        ],
        "metadata_exchange": {
            "input": (
                "Hooks receive structured JSON on stdin containing event context: "
                "tool name, input parameters, session info, and hook-specific data."
            ),
            "output": (
                "Hooks return JSON on stdout to influence Claude Code's behavior: "
                "they can block tool execution, provide decision reasons, inject "
                "additional context, or modify parameters."
            ),
            "bidirectional_flow": (
                "The two-way exchange works as follows: (1) Claude Code serializes "
                "event metadata as JSON and pipes it to the hook's stdin. "
                "(2) The hook processes this data, optionally calling external "
                "services or tools. (3) The hook writes a JSON response to stdout. "
                "(4) Claude Code reads the response and adjusts its behavior "
                "accordingly (e.g., blocking a file write, adding context)."
            ),
        },
    },
    "notebooklm_integration": {
        "title": "NotebookLM Integration via Hooks",
        "description": (
            "NotebookLM is Google's AI-powered research and note-taking tool. "
            "While there is no native integration between Claude Code and "
            "NotebookLM, the hook system provides the extensibility needed "
            "to build a two-way metadata bridge."
        ),
        "how_it_works": [
            (
                "1. Export pathway (Claude Code -> NotebookLM): A PostToolUse hook "
                "captures session artifacts (code changes, file reads, decisions) "
                "and formats them as structured notes or source documents that "
                "can be uploaded to NotebookLM via its API or file import."
            ),
            (
                "2. Import pathway (NotebookLM -> Claude Code): A PreToolUse or "
                "SessionStart hook fetches research notes, summaries, or source "
                "annotations from NotebookLM and injects them as additional "
                "context into Claude Code's session."
            ),
            (
                "3. Continuous sync: By combining SessionStart (initial load), "
                "PostToolUse (incremental export), and PreToolUse (context "
                "enrichment) hooks, a bidirectional sync loop is established."
            ),
        ],
        "metadata_types": [
            "Source annotations and citations from NotebookLM research",
            "Code change summaries exported as NotebookLM sources",
            "Research context injected into Claude Code sessions",
            "Session transcripts formatted as NotebookLM notebooks",
            "Audio overview summaries fed back as coding context",
        ],
    },
}


def sync_query(query: str) -> dict:
    """Process a query in sync mode against the knowledge base."""
    query_lower = query.lower()
    results = {
        "query": query,
        "mode": "sync",
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "findings": [],
        "synthesis": "",
    }

    # Match relevant knowledge base entries
    if "hook" in query_lower:
        hook_info = KNOWLEDGE_BASE["hook_system"]
        results["findings"].append({
            "topic": hook_info["title"],
            "description": hook_info["description"],
            "hook_types": hook_info["hook_types"],
            "metadata_exchange": hook_info["metadata_exchange"],
        })

    if "notebooklm" in query_lower or "notebook" in query_lower:
        nb_info = KNOWLEDGE_BASE["notebooklm_integration"]
        results["findings"].append({
            "topic": nb_info["title"],
            "description": nb_info["description"],
            "integration_steps": nb_info["how_it_works"],
            "metadata_types": nb_info["metadata_types"],
        })

    # Synthesize answer
    if "two-way" in query_lower or "metadata" in query_lower or "exchange" in query_lower:
        results["synthesis"] = (
            "Claude Code's hook system enables two-way metadata exchange with "
            "NotebookLM through its event-driven architecture. "
            "Hooks receive structured JSON on stdin (containing tool names, "
            "parameters, and session context) and return JSON on stdout "
            "(with directives to block, allow, or augment behavior). "
            "This bidirectional JSON pipeline can bridge to NotebookLM by: "
            "(a) exporting code session artifacts as NotebookLM sources via "
            "PostToolUse hooks, and (b) importing NotebookLM research context "
            "into Claude Code sessions via PreToolUse/SessionStart hooks. "
            "The result is a continuous sync loop where coding insights feed "
            "research notes and research context informs coding decisions."
        )

    if not results["findings"]:
        results["findings"].append({
            "topic": "No direct match",
            "description": f"No specific knowledge base entry matched: {query}",
        })
        results["synthesis"] = "Query did not match known topics. Try refining your search."

    return results


async def async_query(query: str) -> dict:
    """Process a query in async mode, simulating concurrent lookups."""
    query_lower = query.lower()

    async def lookup_hooks():
        """Look up hook system knowledge."""
        await asyncio.sleep(0.1)  # Simulate async I/O
        if "hook" in query_lower:
            return KNOWLEDGE_BASE["hook_system"]
        return None

    async def lookup_notebooklm():
        """Look up NotebookLM integration knowledge."""
        await asyncio.sleep(0.1)  # Simulate async I/O
        if "notebooklm" in query_lower or "notebook" in query_lower:
            return KNOWLEDGE_BASE["notebooklm_integration"]
        return None

    hook_result, nb_result = await asyncio.gather(
        lookup_hooks(), lookup_notebooklm()
    )

    results = {
        "query": query,
        "mode": "async",
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "findings": [],
        "synthesis": "",
    }

    if hook_result:
        results["findings"].append({
            "topic": hook_result["title"],
            "description": hook_result["description"],
            "hook_types": hook_result["hook_types"],
            "metadata_exchange": hook_result["metadata_exchange"],
        })

    if nb_result:
        results["findings"].append({
            "topic": nb_result["title"],
            "description": nb_result["description"],
            "integration_steps": nb_result["how_it_works"],
            "metadata_types": nb_result["metadata_types"],
        })

    if "two-way" in query_lower or "metadata" in query_lower or "exchange" in query_lower:
        results["synthesis"] = (
            "Claude Code's hook system enables two-way metadata exchange with "
            "NotebookLM through its event-driven architecture. "
            "Hooks receive structured JSON on stdin (containing tool names, "
            "parameters, and session context) and return JSON on stdout "
            "(with directives to block, allow, or augment behavior). "
            "This bidirectional JSON pipeline can bridge to NotebookLM by: "
            "(a) exporting code session artifacts as NotebookLM sources via "
            "PostToolUse hooks, and (b) importing NotebookLM research context "
            "into Claude Code sessions via PreToolUse/SessionStart hooks. "
            "The result is a continuous sync loop where coding insights feed "
            "research notes and research context informs coding decisions."
        )

    if not results["findings"]:
        results["findings"].append({
            "topic": "No direct match",
            "description": f"No specific knowledge base entry matched: {query}",
        })
        results["synthesis"] = "Query did not match known topics. Try refining your search."

    return results


def export_results(query: str, output_path: str = None) -> str:
    """Export query results to a JSON file."""
    results = sync_query(query)
    results["mode"] = "export"

    if output_path is None:
        timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
        output_path = f"export_{timestamp}.json"

    with open(output_path, "w") as f:
        json.dump(results, f, indent=2)

    return output_path


def print_results(results: dict) -> None:
    """Print formatted results to the console."""
    try:
        from rich.console import Console
        from rich.panel import Panel
        from rich.markdown import Markdown
        from rich.table import Table

        console = Console()
        console.print()
        console.print(Panel(
            f"[bold cyan]Query:[/] {results['query']}\n"
            f"[bold cyan]Mode:[/] {results['mode']}\n"
            f"[bold cyan]Timestamp:[/] {results['timestamp']}",
            title="[bold]Sync Research Results[/]",
            border_style="blue",
        ))

        for finding in results["findings"]:
            console.print()
            console.print(Panel(
                format_finding(finding),
                title=f"[bold green]{finding.get('topic', 'Finding')}[/]",
                border_style="green",
            ))

        if results.get("synthesis"):
            console.print()
            console.print(Panel(
                textwrap.fill(results["synthesis"], width=78),
                title="[bold yellow]Synthesis[/]",
                border_style="yellow",
            ))

        console.print()

    except ImportError:
        # Fallback to plain text
        print(json.dumps(results, indent=2))


def format_finding(finding: dict) -> str:
    """Format a finding dict into readable text."""
    lines = []
    for key, value in finding.items():
        if key == "topic":
            continue
        label = key.replace("_", " ").title()
        if isinstance(value, list):
            lines.append(f"[bold]{label}:[/]")
            for item in value:
                lines.append(f"  • {item}")
        elif isinstance(value, dict):
            lines.append(f"[bold]{label}:[/]")
            for k, v in value.items():
                sub_label = k.replace("_", " ").title()
                lines.append(f"  [dim]{sub_label}:[/] {v}")
        else:
            lines.append(f"[bold]{label}:[/] {value}")
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(
        description="Research sync tool for Claude Code hook system analysis"
    )
    parser.add_argument(
        "--mode",
        choices=["sync", "async", "export"],
        default="sync",
        help="Processing mode (default: sync)",
    )
    parser.add_argument(
        "query",
        nargs="?",
        default=None,
        help="Research query to process",
    )
    parser.add_argument(
        "--format",
        choices=["rich", "json"],
        default="rich",
        help="Output format (default: rich)",
    )
    parser.add_argument(
        "--output",
        default=None,
        help="Output file path for export mode",
    )

    args = parser.parse_args()

    if not args.query:
        parser.error("A query argument is required")

    if args.mode == "sync":
        results = sync_query(args.query)
        if args.format == "json":
            print(json.dumps(results, indent=2))
        else:
            print_results(results)
    elif args.mode == "async":
        results = asyncio.run(async_query(args.query))
        if args.format == "json":
            print(json.dumps(results, indent=2))
        else:
            print_results(results)
    elif args.mode == "export":
        output_path = export_results(args.query, args.output)
        print(f"Results exported to: {output_path}")


if __name__ == "__main__":
    main()
