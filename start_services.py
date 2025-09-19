#!/usr/bin/env python3
"""
Script to start both the MCP server and the Hubitat agent.
This ensures the MCP server is running before the agent tries to connect.
"""
import subprocess
import time
import sys
import signal
import os
from pathlib import Path

def start_mcp_server():
    """Start the MCP server in the background."""
    print("Starting MCP server...")
    mcp_process = subprocess.Popen([
        sys.executable, "-m", "uv", "run", "src/mcp/hubitat_mcp.py"
    ], cwd=Path(__file__).parent)
    return mcp_process

def start_hubitat_agent():
    """Start the Hubitat agent."""
    print("Starting Hubitat agent...")
    agent_process = subprocess.Popen([
        sys.executable, "-m", "uv", "run", "src/agents/hubitat_a2a.py"
    ], cwd=Path(__file__).parent)
    return agent_process

def main():
    """Start both services."""
    mcp_process = None
    agent_process = None
    
    def cleanup(signum, frame):
        """Clean up processes on exit."""
        print("\nShutting down services...")
        if agent_process:
            agent_process.terminate()
        if mcp_process:
            mcp_process.terminate()
        sys.exit(0)
    
    # Set up signal handlers
    signal.signal(signal.SIGINT, cleanup)
    signal.signal(signal.SIGTERM, cleanup)
    
    try:
        # Start MCP server
        mcp_process = start_mcp_server()
        
        # Wait a moment for MCP server to start
        print("Waiting for MCP server to start...")
        time.sleep(3)
        
        # Start Hubitat agent
        agent_process = start_hubitat_agent()
        
        print("Both services are running. Press Ctrl+C to stop.")
        
        # Wait for processes
        while True:
            if mcp_process.poll() is not None:
                print("MCP server stopped unexpectedly")
                break
            if agent_process.poll() is not None:
                print("Hubitat agent stopped unexpectedly")
                break
            time.sleep(1)
            
    except KeyboardInterrupt:
        cleanup(None, None)
    except Exception as e:
        print(f"Error: {e}")
        cleanup(None, None)

if __name__ == "__main__":
    main()
