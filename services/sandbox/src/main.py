"""FastAPI server for the Code Execution Sandbox Sidecar."""

import os
from typing import Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import uvicorn

from .runner import run_python_code

app = FastAPI(
    title="Home Agent Code Execution Sandbox",
    version="0.1.0",
    description="Isolated environment for programmatic tool calling and smart home automation scripts.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ExecuteRequest(BaseModel):
    code: str = Field(..., description="Python script to execute in sandbox")
    timeout: Optional[float] = Field(60.0, description="Execution timeout in seconds")


class ExecuteResponse(BaseModel):
    success: bool
    stdout: str
    stderr: str
    exit_code: int
    duration_ms: float


@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "service": "code-sandbox",
        "sdk": "home",
        "version": "0.1.0",
    }


@app.post("/execute", response_model=ExecuteResponse)
async def execute_code(req: ExecuteRequest):
    if not req.code or not req.code.strip():
        raise HTTPException(status_code=400, detail="No code provided for execution.")

    result = await run_python_code(code=req.code, timeout=req.timeout or 60.0)
    return ExecuteResponse(**result)


def main():
    host = os.getenv("SANDBOX_HOST", "0.0.0.0")
    port = int(os.getenv("SANDBOX_PORT", "7777"))
    print(f"Starting Code Sandbox Sidecar on http://{host}:{port}")
    uvicorn.run(app, host=host, port=port, log_level="info")


if __name__ == "__main__":
    main()
