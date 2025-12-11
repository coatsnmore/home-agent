# AI Chat Notes

first, let's explain how I want you to operate:

1.) I don't want you to provide any suggestions
2.) I want you to respond as succinctly as possible
3.) dont refactor large amounts of code if you're confused about why something isn't working. Stop and ask me for direct
4.) if you're unclear about my instructions, ask me for clarity


## Issue Fixed: Piper TTS Server Not Working

**Problem:** Server was throwing `FileNotFoundError` when trying to execute piper.

**Root Cause:** The piper script's shebang referenced wrong path:
- Had: `/Users/dijonmusk/devl/rhasspy-piper-38917ff/...`
- Actual: `/Users/dijonmusk/devl/PIPER_STUFFS/rhasspy-piper-38917ff/...`

**Solution:** Modified `piper_server.py` to call Python interpreter directly with `-m piper` instead of relying on the piper script.

**Changed in `piper_server.py`:**
```python
# Old:
piper_path = os.path.join(os.path.dirname(__file__), 'piper-dependencies', 'venv', 'bin', 'piper')
process = subprocess.Popen([piper_path, '--model', 'etc/test_voice.onnx', '--output_file', wav_path], ...)

# New:
python_path = os.path.join(os.path.dirname(__file__), 'piper-dependencies', 'venv', 'bin', 'python3')
process = subprocess.Popen([python_path, '-m', 'piper', '--model', 'etc/test_voice.onnx', '--output_file', wav_path], ...)
```

**Result:** Server now works correctly. Uses relative paths, so directory is portable.

## Project Structure
- `piper_server.py` - Flask server for TTS
- `talk-test.html` - Web interface
- `etc/test_voice.onnx` - Voice model
- `piper-dependencies/` - Python venv with piper installed

## Running the Server
```bash
python3 piper_server.py
```
Access at: http://127.0.0.1:8000
