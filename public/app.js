const state = {
  mediaRecorder: null,
  recordedChunks: [],
  recordedBlob: null,
  turnRecorder: null,
  turnChunks: [],
  turnStream: null,
  history: []
};

const els = {
  mode: document.getElementById("mode"),
  meetingTopic: document.getElementById("meeting-topic"),
  topic: document.getElementById("topic"),
  connectBtn: document.getElementById("connect-btn"),
  disconnectBtn: document.getElementById("disconnect-btn"),
  drillBtn: document.getElementById("drill-btn"),
  targetText: document.getElementById("target-text"),
  recordBtn: document.getElementById("record-btn"),
  scoreBtn: document.getElementById("score-btn"),
  speakBtn: document.getElementById("speak-btn"),
  scorePill: document.getElementById("score-pill"),
  scoreSummary: document.getElementById("score-summary"),
  connectionStatus: document.getElementById("connection-status"),
  focusTitle: document.getElementById("focus-title"),
  focusBody: document.getElementById("focus-body"),
  meetingBody: document.getElementById("meeting-body"),
  chat: document.getElementById("chat"),
  messageTemplate: document.getElementById("message-template")
};

function addMessage(role, text, meta = "") {
  const node = els.messageTemplate.content.firstElementChild.cloneNode(true);
  node.classList.add(`role-${role}`);
  node.querySelector(".avatar").textContent = role === "assistant" ? "AI" : "You";
  node.querySelector(".meta").textContent = meta || (role === "assistant" ? "Coach" : "Learner");
  node.querySelector(".bubble").textContent = text;
  els.chat.prepend(node);
}

function setStatus(text) {
  els.connectionStatus.textContent = text;
}

function getGermanVoice() {
  const voices = window.speechSynthesis.getVoices();
  return (
    voices.find((voice) => voice.lang?.toLowerCase().startsWith("de")) ||
    voices.find((voice) => voice.lang?.toLowerCase().startsWith("en")) ||
    null
  );
}

function speakGerman(text, meta = "Model pronunciation") {
  if (!text) return;

  if (!("speechSynthesis" in window)) {
    throw new Error("Browser speech synthesis is not available.");
  }

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "de-DE";
  utterance.rate = 0.92;

  const voice = getGermanVoice();
  if (voice) {
    utterance.voice = voice;
  } else {
    addMessage("assistant", "No German system voice found, using browser default voice.", "Speech");
  }

  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
  addMessage("assistant", text, meta);
}

async function startLiveSession() {
  if (state.turnRecorder?.state === "recording") {
    state.turnRecorder.stop();
    els.connectBtn.textContent = "Start turn";
    setStatus("Processing...");
    return;
  }

  state.turnStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  state.turnChunks = [];
  state.turnRecorder = new MediaRecorder(state.turnStream, { mimeType: "audio/webm" });

  state.turnRecorder.addEventListener("dataavailable", (event) => {
    if (event.data.size > 0) {
      state.turnChunks.push(event.data);
    }
  });

  state.turnRecorder.addEventListener("stop", async () => {
    try {
      const blob = new Blob(state.turnChunks, { type: "audio/webm" });
      const formData = new FormData();
      formData.append("audio", blob, "turn.webm");
      formData.append("mode", els.mode.value);
      formData.append("topic", els.meetingTopic.value.trim());
      formData.append("history", JSON.stringify(state.history));

      const response = await fetch("/api/live-turn", {
        method: "POST",
        body: formData
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Live turn failed.");
      }

      addMessage("user", data.transcript, "Live transcript");
      addMessage("assistant", data.reply, "Coach reply");
      state.history.push(
        { role: "user", content: data.transcript },
        { role: "assistant", content: data.reply }
      );
      setStatus("Ready");
      speakGerman(data.reply, "German playback");
    } catch (error) {
      addMessage("assistant", error.message, "Connection error");
      setStatus("Error");
    } finally {
      state.turnStream?.getTracks().forEach((track) => track.stop());
      state.turnStream = null;
      els.connectBtn.disabled = false;
      els.disconnectBtn.disabled = false;
    }
  });

  els.connectBtn.textContent = "Stop turn";
  els.disconnectBtn.disabled = false;
  setStatus("Recording...");
  state.turnRecorder.start();
}

function stopLiveSession() {
  if (state.turnRecorder?.state === "recording") {
    state.turnRecorder.stop();
  }

  state.history = [];
  els.connectBtn.textContent = "Start turn";
  els.connectBtn.disabled = false;
  els.disconnectBtn.disabled = true;
  setStatus("Idle");
  addMessage("assistant", "Conversation history cleared.", "Session");
}

async function toggleRecording() {
  if (state.mediaRecorder?.state === "recording") {
    state.mediaRecorder.stop();
    els.recordBtn.textContent = "Record phrase";
    return;
  }

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  state.recordedChunks = [];
  state.mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });

  state.mediaRecorder.addEventListener("dataavailable", (event) => {
    if (event.data.size > 0) {
      state.recordedChunks.push(event.data);
    }
  });

  state.mediaRecorder.addEventListener("stop", () => {
    state.recordedBlob = new Blob(state.recordedChunks, { type: "audio/webm" });
    stream.getTracks().forEach((track) => track.stop());
    els.scoreBtn.disabled = false;
    addMessage("user", els.targetText.value.trim(), "Target phrase");
    addMessage("user", "Recording captured. Run accent analysis.", "Recorder");
  });

  state.mediaRecorder.start();
  els.recordBtn.textContent = "Stop recording";
}

async function scoreAccent() {
  if (!state.recordedBlob) return;

  els.scoreBtn.disabled = true;
  els.scoreSummary.textContent = "Analyzing pronunciation...";

  const formData = new FormData();
  formData.append("audio", state.recordedBlob, "accent.webm");
  formData.append("targetText", els.targetText.value.trim());

  const response = await fetch("/api/accent-score", {
    method: "POST",
    body: formData
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Accent analysis failed.");
  }

  els.scorePill.textContent = `${data.score}/100`;
  els.scoreSummary.textContent = data.overall_feedback;
  els.focusTitle.textContent = "Stretch and stress";
  els.focusBody.textContent = data.stretch_letters
    .map((item) => `${item.fragment}: ${item.coaching}`)
    .join(" ");

  addMessage(
    "assistant",
    [
      `Score: ${data.score}/100`,
      `Transcript: ${data.transcript}`,
      `Correct version: ${data.corrected_sentence}`,
      `Flow tip: ${data.smoothness_tip}`,
      `Drill words: ${data.drill_words.join(", ")}`
    ].join("\n"),
    "Accent report"
  );

  els.scoreBtn.disabled = false;
}

async function generateDrill() {
  const response = await fetch("/api/generate-drill", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      topic: els.topic.value.trim(),
      mode: els.mode.value,
      difficulty: "A2-B1"
    })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Could not generate drill.");
  }

  els.focusTitle.textContent = data.title;
  els.focusBody.textContent = data.pronunciation_focus;
  els.meetingBody.textContent = data.meeting_prompt;
  els.targetText.value = data.example_text;

  addMessage("assistant", data.example_text, "Practice text");
}

function bindEvents() {
  window.speechSynthesis?.getVoices();
  window.speechSynthesis?.addEventListener?.("voiceschanged", () => {});

  els.connectBtn.addEventListener("click", async () => {
    try {
      await startLiveSession();
    } catch (error) {
      setStatus("Error");
      addMessage("assistant", error.message, "Connection error");
    }
  });

  els.disconnectBtn.addEventListener("click", stopLiveSession);
  els.recordBtn.addEventListener("click", async () => {
    try {
      await toggleRecording();
    } catch (error) {
      addMessage("assistant", error.message, "Recorder error");
    }
  });
  els.scoreBtn.addEventListener("click", async () => {
    try {
      await scoreAccent();
    } catch (error) {
      addMessage("assistant", error.message, "Score error");
      els.scoreBtn.disabled = false;
    }
  });
  els.drillBtn.addEventListener("click", async () => {
    try {
      await generateDrill();
    } catch (error) {
      addMessage("assistant", error.message, "Drill error");
    }
  });
  els.speakBtn.addEventListener("click", () => {
    try {
      speakGerman(els.targetText.value.trim());
    } catch (error) {
      addMessage("assistant", error.message, "Speech error");
    }
  });
}

bindEvents();
addMessage("assistant", "Choose a mode, generate a drill, or start a short voice turn.", "Coach");
