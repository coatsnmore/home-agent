"""Evaluation for the Hubitat A2A agent using Strands Evals SDK.

Evaluates tool selection correctness against expected trajectories.
Can be run via HTTP endpoint (live service) or standalone script (e.g. docker exec).
"""

from typing import Any

from strands import Agent
from strands_evals import Case, Experiment
from strands_evals.evaluators import TrajectoryEvaluator

# Short description of Hubitat MCP tools for the trajectory evaluator context
HUBITAT_TOOL_DESCRIPTIONS = {
    "list_devices": "List all Hubitat devices (names, IDs, types).",
    "device_details": "Get details and current state for a device (e.g. temperature, level).",
    "device_capabilities": "Get capabilities for a device.",
    "device_commands": "Get available commands for a device.",
    "device_history": "Get event history for a device.",
    "control_device": "Send a command to a device (e.g. on, off, setLevel).",
}


def extract_tools_used_from_messages(messages: list[dict[str, Any]]) -> list[str]:
    """Extract tool names used (in order) from Strands agent message history."""
    tools_used: list[str] = []
    for msg in messages:
        if msg.get("role") != "assistant":
            continue
        for block in msg.get("content", []):
            if "toolUse" in block:
                name = block["toolUse"].get("name")
                if name:
                    tools_used.append(name)
    return tools_used


def get_response_with_tools(case: Case[str, str], tools: list, model, prompt: str) -> dict[str, Any]:
    """Run the Hubitat agent on the case input and return output plus trajectory."""
    agent = Agent(
        name="Hubitat Eval Agent",
        model=model,
        tools=tools,
        system_prompt=prompt,
        callback_handler=None,
    )
    response = agent(case.input)
    trajectory = extract_tools_used_from_messages(agent.messages)
    return {"output": str(response), "trajectory": trajectory}


# Test cases: prompt -> expected tool sequence (in_order is used so sequence matters)
HUBITAT_EVAL_CASES = [
    Case[str, str](
        name="turn-on-all-lights",
        input="Turn on all the lights",
        expected_trajectory=["list_devices", "device_details", "control_device"],
        metadata={
            "category": "control",
            "description": "Should discover devices, identify lights, then turn them on",
        },
    ),
    Case[str, str](
        name="what-temperature",
        input="What temperature is it?",
        expected_trajectory=["list_devices", "device_details"],
        metadata={
            "category": "query",
            "description": "Should discover devices and use device_details to read temperature from capable devices",
        },
    ),
]


def run_evaluation(tools: list, model, prompt: str) -> dict[str, Any]:
    """Run the Hubitat tool-selection evaluation and return serializable results.

    Uses TrajectoryEvaluator with in_order matching: expected tools should appear
    in the actual trajectory in the same order (extra tools are allowed).
    """
    evaluator = TrajectoryEvaluator(
        rubric="""
        Evaluate the tool usage trajectory for this Hubitat smart home task:
        1. Correct tool selection - Were the right tools chosen (list_devices to discover,
           device_details for state/capabilities, control_device for commands)?
        2. Proper sequence - Were tools used in a logical order (discover then act)?
        3. Use the in_order_match_scorer to check the actual trajectory includes the
           expected tools in order. Extra tools are acceptable.

        Score 1.0 if the expected tools were used in order and the task could be fulfilled.
        Score 0.5 if correct tools but suboptimal order or missing a step.
        Score 0.0 if wrong tools or critical steps skipped.
        """,
        trajectory_description=HUBITAT_TOOL_DESCRIPTIONS,
        model=model,
        include_inputs=True,
    )

    def task(case: Case[str, str]) -> dict[str, Any]:
        return get_response_with_tools(case, tools, model, prompt)

    experiment = Experiment[str, str](cases=HUBITAT_EVAL_CASES, evaluators=[evaluator])
    reports = experiment.run_evaluations(task)
    report = reports[0]

    # Report.cases are EvaluationData dicts (input, actual_output, actual_trajectory, etc.)
    n = len(report.cases)
    pass_rate = sum(report.test_passes) / n if n else 0
    average_score = sum(report.scores) / n if n else 0
    case_results = []
    for i, case_data in enumerate(report.cases):
        case_results.append({
            "name": case_data.get("name"),
            "input": case_data.get("input"),
            "expected_trajectory": case_data.get("expected_trajectory"),
            "actual_trajectory": case_data.get("actual_trajectory"),
            "score": report.scores[i] if i < len(report.scores) else None,
            "test_pass": report.test_passes[i] if i < len(report.test_passes) else None,
            "reason": report.reasons[i] if i < len(report.reasons) else None,
        })

    return {
        "summary": {
            "pass_rate": pass_rate,
            "average_score": average_score,
            "total_cases": n,
        },
        "case_results": case_results,
    }


def main() -> None:
    """Standalone entry point: connect to MCP, get tools, run evaluation.

    Use when running inside Docker or against a live MCP server:
        uv run python -m src.agents.hubitat_eval
    or:
        docker exec hubitat-agent uv run python -m src.agents.hubitat_eval
    """
    import os
    from strands_tools.mcp_client import MCPClient
    from mcp.client.streamable_http import streamablehttp_client
    from .llm_provider import get_model

    mcp_host = os.getenv("MCP_SERVER_HOST", "localhost")
    mcp_url = f"http://{mcp_host}:8888/mcp"
    client = MCPClient(lambda: streamablehttp_client(mcp_url))

    client.__enter__()
    try:
        tools = client.list_tools_sync()
        model = get_model(provider="ollama")
        results = run_evaluation(tools, model)
        print("Hubitat evaluation results:")
        for k, v in results["summary"].items():
            print(f"  {k}: {v}")
        for cr in results["case_results"]:
            r = cr.get("reason") or ""
            print(f"  [{cr['name']}] pass={cr['test_pass']} score={cr['score']} reason={r[:80]}{'...' if len(r) > 80 else ''}")
    finally:
        client.__exit__(None, None, None)


if __name__ == "__main__":
    main()
