# Current State

* Web app exposed across network: https://192.168.86.22/
* local in-browser SST (Speech to text)
* local in-browser TTS (Text to speech)
* SSL required to allow device usage (mic), so added nginx
* Web app uses A2A client
* [Agent Card](https://192.168.86.22/agent/.well-known/agent-card.json)
* Currently single agent, setting up for multi-agent
* Connects to custom MCP bridging Hubitat

# Future State

 * Offload TTS to local service or otherwise fix speed
 * Experiment with far field mic devices and wake word for alexa-like experience
 * Compensate for context window limitations with conversation manager strategies
 * Add Spotify Agent and MCP server (port from other project)
 * Add Web Search as tool
 * Add Knowledge as tool
 * Add Memory as log and extraction
 * Add cache for long operations such as device/capability lookup 
 * Add markdown renderer on UI
 * Network DNS