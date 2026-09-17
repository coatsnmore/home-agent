"""Telemetry storage and analytics layer for Home Agent using persistent SQLite."""

import json
import os
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

# Ensure data directory exists
CURRENT_FILE = Path(__file__).resolve()
AGENT_DIR = CURRENT_FILE.parent.parent  # services/agent
DATA_DIR = AGENT_DIR / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA_DIR / "telemetry.db"


def get_db_connection() -> sqlite3.Connection:
    """Create a connection to the SQLite telemetry database."""
    conn = sqlite3.connect(str(DB_PATH), timeout=10.0)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    """Initialize database tables for telemetry recording."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS tool_executions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                session_id TEXT,
                tool_name TEXT NOT NULL,
                duration_ms REAL NOT NULL,
                success INTEGER NOT NULL,
                error_message TEXT,
                args_summary TEXT
            )
            """
        )
        cursor.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_tool_timestamp 
            ON tool_executions (timestamp)
            """
        )
        cursor.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_tool_name 
            ON tool_executions (tool_name)
            """
        )
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS agent_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                event_type TEXT NOT NULL,
                latency_ms REAL,
                metadata_json TEXT
            )
            """
        )
        conn.commit()


# Run initialization on import
init_db()


def record_tool_execution(
    tool_name: str,
    duration_ms: float,
    success: bool,
    error_message: Optional[str] = None,
    args_summary: str = "",
    session_id: str = "",
):
    """Record a single tool execution into persistent telemetry store."""
    try:
        now_utc = datetime.now(timezone.utc).isoformat()
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT INTO tool_executions (
                    timestamp, session_id, tool_name, duration_ms, success, error_message, args_summary
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    now_utc,
                    session_id,
                    tool_name,
                    round(duration_ms, 2),
                    1 if success else 0,
                    error_message or None,
                    args_summary[:500] if args_summary else "",
                ),
            )
            conn.commit()
    except Exception as e:
        print(f"[Telemetry] Warning: failed to record tool execution: {e}")


def get_telemetry_stats(time_window_hours: float = 24.0) -> Dict[str, Any]:
    """Calculate aggregated telemetry statistics over a given time window."""
    try:
        cutoff = datetime.fromtimestamp(
            time.time() - (time_window_hours * 3600), timezone.utc
        ).isoformat()

        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT 
                    tool_name,
                    duration_ms,
                    success,
                    error_message,
                    timestamp
                FROM tool_executions
                WHERE timestamp >= ?
                ORDER BY timestamp DESC
                """,
                (cutoff,),
            )
            rows = cursor.fetchall()

        total = len(rows)
        if total == 0:
            return {
                "time_window_hours": time_window_hours,
                "total_executions": 0,
                "successful_executions": 0,
                "failed_executions": 0,
                "error_rate_pct": 0.0,
                "avg_duration_ms": 0.0,
                "p50_duration_ms": 0.0,
                "p95_duration_ms": 0.0,
                "tools": {},
            }

        durations = sorted([r["duration_ms"] for r in rows])
        successes = sum(1 for r in rows if r["success"] == 1)
        failures = total - successes
        error_rate = round((failures / total) * 100, 2)

        avg_ms = round(sum(durations) / total, 2)
        p50_ms = round(durations[int(total * 0.50)], 2)
        p95_index = min(int(total * 0.95), total - 1)
        p95_ms = round(durations[p95_index], 2)

        # By tool breakdown
        by_tool: Dict[str, Dict[str, Any]] = {}
        for r in rows:
            name = r["tool_name"]
            if name not in by_tool:
                by_tool[name] = {"count": 0, "failures": 0, "durations": []}
            by_tool[name]["count"] += 1
            if r["success"] == 0:
                by_tool[name]["failures"] += 1
            by_tool[name]["durations"].append(r["duration_ms"])

        tool_summary = {}
        for name, data in by_tool.items():
            cnt = data["count"]
            fails = data["failures"]
            d_list = sorted(data["durations"])
            tool_summary[name] = {
                "count": cnt,
                "failures": fails,
                "error_rate_pct": round((fails / cnt) * 100, 2) if cnt > 0 else 0.0,
                "avg_duration_ms": round(sum(d_list) / cnt, 2) if cnt > 0 else 0.0,
                "p50_duration_ms": round(d_list[int(cnt * 0.50)], 2) if cnt > 0 else 0.0,
            }

        return {
            "time_window_hours": time_window_hours,
            "total_executions": total,
            "successful_executions": successes,
            "failed_executions": failures,
            "error_rate_pct": error_rate,
            "avg_duration_ms": avg_ms,
            "p50_duration_ms": p50_ms,
            "p95_duration_ms": p95_ms,
            "tools": tool_summary,
        }
    except Exception as e:
        print(f"[Telemetry] Error computing stats: {e}")
        return {"error": str(e)}


def get_recent_executions(limit: int = 50) -> List[Dict[str, Any]]:
    """Retrieve the most recent tool executions."""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT 
                    id,
                    timestamp,
                    session_id,
                    tool_name,
                    duration_ms,
                    success,
                    error_message,
                    args_summary
                FROM tool_executions
                ORDER BY id DESC
                LIMIT ?
                """,
                (limit,),
            )
            rows = cursor.fetchall()
            return [dict(r) for r in rows]
    except Exception as e:
        print(f"[Telemetry] Error fetching recent executions: {e}")
        return []
