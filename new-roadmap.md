Okay... so I want do a few things....

1. Upgrade every software package to current
2. Remove the home a2a agent (I only have been using the hubitat agent)
3. Switch away from A2A... I believe A2A should be used between agents, not between client and agent. I am thinking about switching to AGUI and A2UI instead.
4. refactor the repo structure to be more coherent (src vs home-page vs docker, etc.)
5. Use Agent Skills with the hubitat strands agent
6. clean up instruction for the hubitat agent becuase it still references mcp server it no longer has access to.
7. improve the UI to take advantage of AGUI/A2UI and look good
8. Move away from VanillaJS to something more standard if and only if it's simpler
9. maintain offline or close to offline STT and TTS
10. Move away from my custom model router and switch to something like a containered litellm that makes switching easier.. although I would still default to ollama