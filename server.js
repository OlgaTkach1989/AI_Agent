import dotenv from "dotenv";
import express from "express";
import multer from "multer";

dotenv.config();

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
const port = process.env.PORT || 3000;

const GROQ_API_KEY = process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY;
const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
const CHAT_MODEL = "llama-3.3-70b-versatile";
const STRUCTURED_MODEL = "openai/gpt-oss-20b";
const TRANSCRIBE_MODEL = "whisper-large-v3-turbo";

app.use(express.json({ limit: "2mb" }));
app.use(express.static("public"));

function assertApiKey(res) {
  if (!GROQ_API_KEY) {
    res.status(500).json({
      error: "GROQ_API_KEY is missing. Add it to .env and restart the server."
    });
    return false;
  }

  return true;
}

function germanCoachInstructions(mode, meetingTopic) {
  const baseRules = [
    "You are a strict but encouraging German pronunciation coach for a Russian-speaking learner.",
    "Default to speaking German first, then give concise support in Russian only when clarification helps.",
    "Listen for accent issues and explain them concretely: vowel length, consonant sharpness, umlauts, ich and ach sounds, r, ch, sentence stress, rhythm, and linking between words.",
    "When correcting pronunciation, explicitly say which syllable is stressed and which letter or sound must be longer, shorter, softer, or sharper.",
    "Use very short examples and ask the learner to repeat.",
    "If the learner speaks ungrammatical German, prioritize pronunciation feedback first and grammar second.",
    "Keep spoken answers compact so the app feels live."
  ];

  if (mode === "meeting") {
    baseRules.push(
      `Run a realistic German meeting simulation about: ${meetingTopic || "a weekly product team sync"}.`,
      "Act as a colleague or manager in the meeting.",
      "After each learner turn, briefly continue the meeting and then give one pronunciation correction."
    );
  } else if (mode === "score") {
    baseRules.push("In score mode, ask the learner to read one sentence at a time and focus on precise articulation coaching.");
  } else {
    baseRules.push("In live mode, keep the interaction conversational and responsive, like a speaking trainer during a call.");
  }

  return baseRules.join(" ");
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const message = data?.error?.message || "Groq request failed.";
    throw new Error(message);
  }

  return data;
}

async function groqTranscribeAudio(file, prompt = "") {
  const formData = new FormData();
  const audioBlob = new Blob([file.buffer], { type: file.mimetype || "audio/webm" });

  formData.set("file", audioBlob, file.originalname || "audio.webm");
  formData.set("model", TRANSCRIBE_MODEL);
  formData.set("language", "de");
  formData.set("response_format", "json");

  if (prompt) {
    formData.set("prompt", prompt);
  }

  return requestJson(`${GROQ_BASE_URL}/audio/transcriptions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GROQ_API_KEY}`
    },
    body: formData
  });
}

async function groqChat({ messages, responseFormat }) {
  return requestJson(`${GROQ_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GROQ_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: CHAT_MODEL,
      temperature: 0.3,
      messages,
      ...(responseFormat ? { response_format: responseFormat } : {})
    })
  });
}

async function groqStructuredChat({ messages, schemaName, schema }) {
  return requestJson(`${GROQ_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GROQ_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: STRUCTURED_MODEL,
      temperature: 0.2,
      messages,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: schemaName,
          strict: true,
          schema
        }
      }
    })
  });
}

function parseCompletionText(response) {
  const text = response.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error("Model returned no content.");
  }
  return text;
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/live-turn", upload.single("audio"), async (req, res) => {
  if (!assertApiKey(res)) return;

  if (!req.file) {
    res.status(400).json({ error: "Audio file is required." });
    return;
  }

  try {
    const mode = req.body.mode || "live";
    const topic = req.body.topic || "";
    const history = JSON.parse(req.body.history || "[]");

    const transcription = await groqTranscribeAudio(
      req.file,
      "This is a German learner speaking German in a pronunciation coaching app."
    );

    const completion = await groqChat({
      messages: [
        { role: "system", content: germanCoachInstructions(mode, topic) },
        ...history,
        { role: "user", content: transcription.text }
      ]
    });

    res.json({
      transcript: transcription.text,
      reply: parseCompletionText(completion)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/accent-score", upload.single("audio"), async (req, res) => {
  if (!assertApiKey(res)) return;

  if (!req.file) {
    res.status(400).json({ error: "Audio file is required." });
    return;
  }

  try {
    const targetText = req.body.targetText?.trim() || "";
    const transcription = await groqTranscribeAudio(
      req.file,
      "This is a German learner reading or answering in German. Preserve learner wording and hesitations."
    );

    const schema = {
      type: "object",
      additionalProperties: false,
      properties: {
        score: { type: "integer", minimum: 0, maximum: 100 },
        transcript: { type: "string" },
        corrected_sentence: { type: "string" },
        overall_feedback: { type: "string" },
        smoothness_tip: { type: "string" },
        stretch_letters: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              fragment: { type: "string" },
              coaching: { type: "string" }
            },
            required: ["fragment", "coaching"]
          }
        },
        drill_words: {
          type: "array",
          items: { type: "string" }
        }
      },
      required: [
        "score",
        "transcript",
        "corrected_sentence",
        "overall_feedback",
        "smoothness_tip",
        "stretch_letters",
        "drill_words"
      ]
    };

    const analysis = await groqStructuredChat({
      messages: [
        {
          role: "system",
          content: [
            "You are a German pronunciation evaluator.",
            "Score accent naturalness from 0 to 100.",
            "Focus on likely pronunciation issues inferred from the learner transcript and target text.",
            "Give tactical feedback for a Russian-speaking learner.",
            "Return valid JSON only."
          ].join(" ")
        },
        {
          role: "user",
          content: JSON.stringify({
            targetText,
            learnerTranscript: transcription.text
          })
        }
      ],
      schemaName: "accent_assessment",
      schema
    });

    res.json(JSON.parse(parseCompletionText(analysis)));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/generate-drill", async (req, res) => {
  if (!assertApiKey(res)) return;

  try {
    const topic = req.body.topic?.trim() || "small talk at work";
    const difficulty = req.body.difficulty?.trim() || "A2-B1";
    const mode = req.body.mode?.trim() || "live";

    const schema = {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string" },
        example_text: { type: "string" },
        pronunciation_focus: { type: "string" },
        meeting_prompt: { type: "string" }
      },
      required: ["title", "example_text", "pronunciation_focus", "meeting_prompt"]
    };

    const response = await groqStructuredChat({
      messages: [
        {
          role: "system",
          content: [
            "You create compact German practice material for pronunciation training.",
            "Prefer useful workplace German.",
            "All examples must be in natural German.",
            "Return valid JSON only."
          ].join(" ")
        },
        {
          role: "user",
          content: JSON.stringify({ topic, difficulty, mode })
        }
      ],
      schemaName: "practice_drill",
      schema
    });

    res.json(JSON.parse(parseCompletionText(response)));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(port, () => {
  console.log(`Deutsch voice coach listening on http://localhost:${port}`);
});
