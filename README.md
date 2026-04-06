# Deutsch Voice Coach

Минимальный прототип персонального агента для тренировки немецкого произношения:

- быстрый push-to-talk live режим на базе Groq STT + LLM
- accent score по записанной фразе
- meeting simulation для рабочих сценариев
- ChatGPT-подобный UI с голосом

## Stack

- Node.js + Express
- Browser MediaRecorder + SpeechSynthesis
- Groq Speech-to-Text
- Groq Chat Completions API

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env` from `.env.example` and set `GROQ_API_KEY`.

3. Start the app:

```bash
npm run dev
```

4. Open `http://localhost:3000`

## How it works

### Live Conversation

The browser records a short user turn and sends it to the backend.

The backend:

1. transcribes speech with Groq Whisper
2. sends transcript plus conversation history to a Groq chat model
3. returns a compact coaching reply

The browser then reads the German reply aloud with local `speechSynthesis` if a German system voice is available.

### Accent Score

The browser records a short audio clip.

The backend:

1. transcribes it with `whisper-large-v3-turbo`
2. compares the learner output against the target text
3. asks a Groq chat model for a structured pronunciation report

Returned report includes:

- score from 0 to 100
- transcript
- corrected sentence
- smoothness tip
- fragments where sounds should be stretched or sharpened
- drill words

### Meeting Simulation

The same turn-based flow is started with different instructions, so the assistant behaves like a colleague or manager and keeps correcting pronunciation inside the scenario.

## Notes

- Browser microphone permission is required.
- Groq does not currently provide the same browser realtime voice session flow used by OpenAI Realtime, so this version uses short push-to-talk turns instead of full duplex voice streaming.
- Groq text-to-speech documentation currently lists English and Arabic voices, not German. German playback therefore uses the browser's local speech engine.
- The score is heuristic feedback generated from transcript comparison and coaching prompts, not a phoneme-level acoustic benchmark.
