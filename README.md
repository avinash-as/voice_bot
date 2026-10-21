# AI Voice Sales Bot

A working AI voice sales bot that conducts real voice conversations, shows live chat, records calls, generates AI summaries, assigns sales status, and keeps call history.

## Features
- Voice conversation using browser Speech Recognition + Speech Synthesis
- Live chat transcript (bot & customer)
- Start / End call, mute, duration timer, status
- Call recording with consent (MediaRecorder) + playback
- AI summary: overview, requirements, objections, next steps
- Auto sales status: Converted / Interested / Follow-up Required / Not Interested / Demo Requested / No Response
- Call history with recordings, summaries, transcripts, statuses (stored in browser IndexedDB)
- Configurable product, language (English/Hindi/Telugu), voice, LLM endpoint

## Live Demo
https://avinash-as.github.io/voice_bot/

## Run locally
1. `cd sales-bot`
2. `python -m http.server 8080`  (or any static server)
3. Open http://localhost:8080 in Chrome/Edge
4. Allow microphone access

## LLM
Uses free Pollinations OpenAI-compatible endpoint by default (no API key). You can set your own endpoint/key in Settings.

## Notes
- Best in Chrome/Edge (SpeechRecognition support).
- Data stays in the browser (IndexedDB). Clearing site data removes history.
- Recording consent is required before first call.
