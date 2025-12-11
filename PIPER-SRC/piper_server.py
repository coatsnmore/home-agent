#!/usr/bin/env piper-dependencies/venv/bin/python3
from flask import Flask, send_file, request
import subprocess
import os
import tempfile

app = Flask(__name__)

@app.route('/')
def index():
    # Serve the home-page index.html which includes the talk-test content
    return send_file('../home-page/index.html')

@app.route('/speak', methods=['POST'])
def speak():
    text = request.json.get('text', 'Hello world')
    
    # Create temporary file for audio
    fd, wav_path = tempfile.mkstemp(suffix='.wav')
    os.close(fd)
    
    try:
        # Run piper to generate speech (use system python3 with piper installed)
        process = subprocess.Popen(
            ['python3', '-m', 'piper', '--model', 'etc/test_voice.onnx', '--output_file', wav_path],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )
        process.communicate(input=text)
        
        # Send the audio file
        return send_file(wav_path, mimetype='audio/wav')
    finally:
        # Clean up temp file after sending
        if os.path.exists(wav_path):
            os.remove(wav_path)

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=8000)
