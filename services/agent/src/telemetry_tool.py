"""Conversational diagnostics tool for Home Agent system telemetry."""

import json
from typing import Optional
from strands import tool
from .telemetry import get_telemetry_stats, get_recent_executions


@tool
def get_system_telemetry(
    query_type: str = "summary",
    time_window_hours: float = 24.0,
    tool_name: Optional[str] = None,
) -> str:
    """Retrieve system execution telemetry, tool latencies, and error diagnostics.

    Args:
        query_type: One of:
            - 'summary': General overview of system performance, total executions, error rates, and p50/p95 latency.
            - 'errors': List of recent failures with error messages and failing tool names.
            - 'tools': Breakdown of executions and latencies per tool.
            - 'recent': Chronological log of recent tool executions.
        time_window_hours: Time window in hours to analyze (default: 24.0).
        tool_name: Optional specific tool name to filter by (e.g. 'execute_code', 'get_outside_weather').

    Returns:
        A structured diagnostic summary formatted for presentation to the user.
    """
    stats = get_telemetry_stats(time_window_hours=time_window_hours)
    
    if "error" in stats:
        return f"Unable to retrieve telemetry: {stats['error']}"

    if query_type == "summary":
        total = stats.get("total_executions", 0)
        if total == 0:
            return f"No tool executions recorded in the past {time_window_hours} hour(s)."
        
        lines = [
            f"### System Telemetry (Past {time_window_hours}h)",
            f"- **Total Executions**: {stats['total_executions']}",
            f"- **Success Rate**: {round(100 - stats['error_rate_pct'], 1)}% ({stats['successful_executions']} passed, {stats['failed_executions']} failed)",
            f"- **Latency**: Avg {stats['avg_duration_ms']}ms | p50: {stats['p50_duration_ms']}ms | p95: {stats['p95_duration_ms']}ms",
            "",
            "| Tool | Calls | Failures | Error Rate | Avg Duration |",
            "| :--- | :--- | :--- | :--- | :--- |",
        ]
        for name, tdata in stats.get("tools", {}).items():
            lines.append(
                f"| `{name}` | {tdata['count']} | {tdata['failures']} | {tdata['error_rate_pct']}% | {tdata['avg_duration_ms']}ms |"
            )
        return "\n".join(lines)

    elif query_type == "errors":
        recent = get_recent_executions(limit=50)
        failures = [r for r in recent if r.get("success") == 0]
        if tool_name:
            failures = [f for f in failures if f.get("tool_name") == tool_name]

        if not failures:
            return f"No errors recorded for {'tool ' + tool_name if tool_name else 'any tools'} in recent history."

        lines = [
            f"### Recent Failures ({len(failures)} found)",
            "| Timestamp (UTC) | Tool | Duration | Error Message |",
            "| :--- | :--- | :--- | :--- |",
        ]
        for f in failures[:15]:
            ts = f.get("timestamp", "").replace("T", " ")[:19]
            tname = f.get("tool_name", "unknown")
            dur = f"{f.get('duration_ms', 0)}ms"
            err = (f.get("error_message") or "Unknown error").replace("\n", " ")[:100]
            lines.append(f"| {ts} | `{tname}` | {dur} | {err} |")
        return "\n".join(lines)

    elif query_type == "recent":
        recent = get_recent_executions(limit=20)
        if tool_name:
            recent = [r for r in recent if r.get("tool_name") == tool_name]

        if not recent:
            return f"No executions recorded for {'tool ' + tool_name if tool_name else 'any tools'}."

        lines = [
            f"### Recent Execution Log (Latest {len(recent)})",
            "| Timestamp (UTC) | Tool | Status | Duration | Args / Summary |",
            "| :--- | :--- | :--- | :--- | :--- |",
        ]
        for r in recent:
            ts = r.get("timestamp", "").replace("T", " ")[:19]
            tname = r.get("tool_name", "unknown")
            status = "✅ OK" if r.get("success") == 1 else "❌ Error"
            dur = f"{r.get('duration_ms', 0)}ms"
            args = (r.get("args_summary") or "").replace("\n", " ")[:60]
            lines.append(f"| {ts} | `{tname}` | {status} | {dur} | {args} |")
        return "\n".join(lines)

    else:
        return json.dumps(stats, indent=2)
