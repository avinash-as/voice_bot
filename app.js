// ---------- State ----------
const DEFAULT_PRODUCT = {
  name: "BizFlow CRM",
  description: "A cloud-based CRM for small businesses: lead & contact management, sales pipeline, invoicing, WhatsApp & email integration, task automation, and real-time analytics dashboards.",
  price: "₹999/month (14-day free trial, no credit card required)"
};
const DEFAULT_SETTINGS = {
  product: { ...DEFAULT_PRODUCT },
  language: "bilingual",
  voiceURI: "",
  llmEndpoint: "https://text.pollinations.ai/openai",
  llmModel: "gpt-oss-20b",
  apiKey: ""
};

let settings = loadSettings();
let call = null; // active call object
let db = null;

// ---------- IndexedDB ----------
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("salesbot", 1);
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains("calls")) {
        const store = d.createObjectStore("calls", { keyPath: "id", autoIncrement: true });
        store.createIndex("date", "date");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveCall(record) {
  const d = await openDB();
  return new Promise((resolve, reject) => {
    const tx = d.transaction("calls", "readwrite");
    const store = tx.objectStore("calls");
    const req = store.add(record);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getAllCalls() {
  const d = await openDB();
  return new Promise((resolve, reject) => {
    const tx = d.transaction("calls", "readonly");
    const store = tx.objectStore("calls");
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result.reverse());
    req.onerror = () => reject(req.error);
  });
}

async function deleteAllCalls() {
  const d = await openDB();
  return new Promise((resolve, reject) => {
    const tx = d.transaction("calls", "readwrite");
    const store = tx.objectStore("calls");
    const req = store.clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ---------- Settings persistence ----------
function loadSettings() {
  try {
    const raw = localStorage.getItem("salesbot_settings");
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw), product: { ...DEFAULT_PRODUCT, ...(JSON.parse(raw).product||{}) } };
  } catch(e){}
  return { ...DEFAULT_SETTINGS, product: { ...DEFAULT_PRODUCT } };
}
function persistSettings() {
  localStorage.setItem("salesbot_settings", JSON.stringify(settings));
}

// ---------- Helpers ----------
const $ = (id) => document.getElementById(id);
function fmtTime(sec) {
  const m = Math.floor(sec/60).toString().padStart(2,"0");
  const s = Math.floor(sec%60).toString().padStart(2,"0");
  return `${m}:${s}`;
}
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function parseJSON(text) {
  try { return JSON.parse(text); } catch(e) {}
  const m = text.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch(e) {} }
  return null;
}
function recognitionLang() {
  if (settings.language === "bilingual") return "hi-IN";
  return settings.language;
}
function langCode() { return recognitionLang(); }
function hasHindi(text) { return /[\u0900-\u097F]/.test(text || ""); }
function ttsLangFor(text) {
  if (settings.language === "bilingual") return hasHindi(text) ? "hi-IN" : "en-IN";
  return settings.language;
}

// ---------- LLM ----------
async function llmChat(messages) {
  const endpoint = settings.llmEndpoint || "https://text.pollinations.ai/openai";
  const headers = { "Content-Type": "application/json" };
  if (settings.apiKey) headers["Authorization"] = "Bearer " + settings.apiKey;
  const body = { model: settings.llmModel || "gpt-oss-20b", messages };
  const res = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(body) });
  if (!res.ok) throw new Error("LLM error " + res.status);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || data.content || "";
}

// ---------- Speech ----------
let recognition = null;
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

function getVoices() {
  return new Promise((resolve) => {
    let voices = speechSynthesis.getVoices();
    if (voices.length) return resolve(voices);
    speechSynthesis.onvoiceschanged = () => resolve(speechSynthesis.getVoices());
    setTimeout(() => resolve(speechSynthesis.getVoices()), 500);
  });
}

function pickVoice(text) {
  const voices = speechSynthesis.getVoices();
  if (settings.voiceURI) {
    const v = voices.find(v => v.voiceURI === settings.voiceURI);
    if (v) return v;
  }
  const lang = ttsLangFor(text);
  const primary = lang.split("-")[0];
  return voices.find(v => v.lang === lang) || voices.find(v => v.lang.startsWith(primary)) || voices.find(v => v.lang.startsWith("en")) || voices[0];
}

function speak(text) {
  return new Promise((resolve) => {
    if (!text) return resolve();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = ttsLangFor(text);
    const v = pickVoice(text);
    if (v) u.voice = v;
    u.rate = 1.0;
    u.pitch = 1.0;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    window.speechSynthesis.speak(u);
  });
}

// ---------- UI helpers ----------
function setCallStatus(text, color) {
  const el = $("callStatus");
  el.textContent = text;
  el.className = "text-lg font-semibold " + (color || "text-slate-300");
}

function addChatMessage(role, text) {
  const log = $("chatLog");
  const row = document.createElement("div");
  row.className = "chat-row";
  const bubble = document.createElement("div");
  bubble.className = "chat-bubble " + (role === "assistant" ? "bot" : "user");
  const meta = document.createElement("div");
  meta.className = "chat-meta";
  meta.textContent = role === "assistant" ? "Bot" : "You";
  const p = document.createElement("div");
  p.textContent = text;
  bubble.appendChild(meta);
  bubble.appendChild(p);
  row.appendChild(bubble);
  log.appendChild(row);
  log.scrollTop = log.scrollHeight;
}

function setInterim(text) {
  $("interimLine").textContent = text ? ("Listening: " + text) : "";
}

function setTyping(on) {
  const log = $("chatLog");
  let t = document.getElementById("typingIndicator");
  if (on) {
    if (!t) {
      t = document.createElement("div");
      t.id = "typingIndicator";
      t.className = "chat-row";
      t.innerHTML = '<div class="chat-bubble bot"><div class="typing"><span></span><span></span><span></span></div></div>';
      log.appendChild(t);
      log.scrollTop = log.scrollHeight;
    }
  } else {
    if (t) t.remove();
  }
}

function renderProductCard() {
  $("productName").textContent = settings.product.name;
  $("productDesc").textContent = settings.product.description;
  $("productPrice").textContent = settings.product.price;
}

// ---------- Call flow ----------
async function startCall() {
  if (localStorage.getItem("salesbot_consent") !== "yes") {
    $("consentBanner").classList.remove("hidden");
    window._pendingStart = () => doStartCall();
    return;
  }
  await doStartCall();
}

async function doStartCall() {
  // mic permission
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    alert("Microphone access is required. " + e.message);
    return;
  }

  call = {
    active: true,
    startTime: Date.now(),
    timerInterval: null,
    stream,
    recorder: null,
    chunks: [],
    messages: [],
    noResponseCount: 0,
    processing: false,
    muted: false
  };

  // recorder (optional)
  try {
    try { call.recorder = new MediaRecorder(stream); }
    catch (e) { call.recorder = new MediaRecorder(stream, { mimeType: "audio/webm" }); }
    call.recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) call.chunks.push(e.data); };
    call.recorder.start(1000);
  } catch (e) {
    call.recorder = null;
  }

  // ui
  $("startCallBtn").disabled = true;
  $("endCallBtn").disabled = false;
  $("muteBtn").disabled = false;
  $("chatLog").innerHTML = "";
  setCallStatus("Connecting...", "text-amber-400");

  // timer
  call.timerInterval = setInterval(() => {
    const sec = (Date.now() - call.startTime) / 1000;
    $("callTimer").textContent = fmtTime(sec);
  }, 500);

  setCallStatus("In Call", "text-emerald-400");

  // greeting
  call.processing = true;
  setTyping(true);
  let greeting;
  try {
    greeting = await llmChat([
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: "Start the call: greet the customer warmly, introduce " + settings.product.name + " in one sentence, and ask how you can help today." }
    ]);
  } catch (e) {
    greeting = "Hello! Welcome to " + settings.product.name + ". How can I help you today?";
  }
  setTyping(false);
  addChatMessage("assistant", greeting);
  call.messages.push({ role: "assistant", text: greeting });
  call.processing = false;
  await speak(greeting);
  if (call.active) startListening();
}

function buildSystemPrompt() {
  const langRule = settings.language === "bilingual"
    ? "Detect the language the customer is using (Hindi or English) and reply in that SAME language. You may mix (Hinglish) only if the customer does."
    : settings.language === "en-US" ? "Reply in English."
    : settings.language === "hi-IN" ? "Reply in Hindi."
    : "Reply in Telugu.";
  return `You are a friendly, professional sales representative for ${settings.product.name}.
Product description: ${settings.product.description}
Pricing: ${settings.product.price}
Your goal: understand the customer's needs, answer questions accurately, handle objections, and guide them toward conversion (purchase) or a product demo.
Rules:
- ${langRule}
- Keep replies concise (2-3 sentences) and ask one question at a time.
- Be helpful, not pushy. Acknowledge concerns.
- If the customer wants to buy, guide them to signup/payment. If unsure, offer a demo.
- Never make up features not in the description.`;
}

function buildMessages() {
  const msgs = [{ role: "system", content: buildSystemPrompt() }];
  for (const m of call.messages) {
    msgs.push({ role: m.role, content: m.text });
  }
  return msgs;
}

function startListening() {
  if (!call || !call.active || call.processing) return;
  if (!SpeechRecognition) {
    alert("Speech recognition not supported in this browser. Use Chrome/Edge.");
    return;
  }
  recognition = new SpeechRecognition();
  recognition.lang = recognitionLang();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  let finalText = "";
  recognition.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) finalText += t + " ";
      else interim += t;
    }
    setInterim((finalText + interim).trim());
  };
  recognition.onend = async () => {
    setInterim("");
    if (!call || !call.active) return;
    const userText = finalText.trim();
    finalText = "";
    if (!userText) {
      call.noResponseCount = (call.noResponseCount || 0) + 1;
      if (call.noResponseCount >= 2) {
        await endCall("No Response");
        return;
      }
      // prompt
      const prompt = "The customer hasn't responded. Politely check if they're still there and ask if they have questions.";
      call.processing = true;
      setTyping(true);
      let reply;
      try { reply = await llmChat(buildMessages().concat([{role:"user", content: prompt}])); }
      catch(e) { reply = "Are you still there? Do you have any questions about the product?"; }
      setTyping(false);
      addChatMessage("assistant", reply);
      call.messages.push({ role: "assistant", text: reply });
      call.processing = false;
      await speak(reply);
      if (call.active) startListening();
      return;
    }
    call.noResponseCount = 0;
    addChatMessage("user", userText);
    call.messages.push({ role: "user", text: userText });

    call.processing = true;
    setTyping(true);
    let reply;
    try {
      reply = await llmChat(buildMessages());
    } catch (e) {
      reply = "Sorry, I had a connection issue. Could you repeat that?";
    }
    setTyping(false);
    if (!call.active) { call.processing = false; return; }
    addChatMessage("assistant", reply);
    call.messages.push({ role: "assistant", text: reply });
    call.processing = false;
    await speak(reply);
    if (call.active) startListening();
  };
  recognition.onerror = (e) => {
    if (e.error === "not-allowed") {
      alert("Microphone permission denied.");
    }
    // ignore no-speech
  };
  try {
    recognition.start();
  } catch (e) {}
}

async function endCall(forcedStatus) {
  if (!call) return;
  const c = call;
  call = null; // mark inactive
  c.active = false;

  // stop recognition
  try { recognition?.stop(); } catch(e) {}
  window.speechSynthesis.cancel();

  // stop recorder
  if (c.recorder && c.recorder.state !== "inactive") {
    await new Promise((resolve) => {
      c.recorder.onstop = resolve;
      try { c.recorder.stop(); } catch(e) { resolve(); }
    });
  }
  // stop tracks
  c.stream?.getTracks().forEach(t => t.stop());

  clearInterval(c.timerInterval);
  const duration = (Date.now() - c.startTime) / 1000;

  $("startCallBtn").disabled = false;
  $("endCallBtn").disabled = true;
  $("muteBtn").disabled = true;
  setCallStatus("Processing summary...", "text-amber-400");

  const audioBlob = new Blob(c.chunks, { type: "audio/webm" });

  // generate summary
  let summaryData = null;
  const transcript = c.messages.map(m => `${m.role === "assistant" ? "Bot" : "Customer"}: ${m.text}`).join("\n");
  try {
    const raw = await llmChat([
      { role: "system", content: "You are a sales call analyst. Return ONLY valid JSON, no markdown." },
      { role: "user", content: `Analyze this sales call transcript and return JSON with keys:
- summary: string (2-3 sentence overview)
- requirements: array of strings (customer needs)
- objections: array of strings (concerns raised)
- nextSteps: array of strings (recommended follow-ups)
- status: one of "Converted","Interested","Follow-up Required","Not Interested","Demo Requested","No Response"

Transcript:
${transcript}` }
    ]);
    summaryData = parseJSON(raw);
  } catch (e) {
    summaryData = null;
  }
  if (!summaryData) {
    summaryData = { summary: "Call completed. Summary unavailable.", requirements: [], objections: [], nextSteps: [], status: "Follow-up Required" };
  }
  const finalStatus = forcedStatus || summaryData.status || "Follow-up Required";

  // save
  try {
    await saveCall({
      date: new Date().toISOString(),
      duration,
      transcript: c.messages,
      summary: summaryData.summary,
      requirements: summaryData.requirements || [],
      objections: summaryData.objections || [],
      nextSteps: summaryData.nextSteps || [],
      status: finalStatus,
      audioBlob,
      language: settings.language
    });
  } catch (e) {
    console.error("save failed", e);
  }

  setCallStatus("Idle", "text-slate-300");
  $("callTimer").textContent = "00:00";

  showSummary(summaryData, finalStatus, transcript, audioBlob, duration);
  await refreshHistory();
}

function showSummary(data, status, transcript, audioBlob, duration) {
  const content = $("summaryContent");
  const url = audioBlob ? URL.createObjectURL(audioBlob) : null;
  content.innerHTML = `
    <div class="mb-3"><span class="status-badge status-${status.replace(/ /g,'-')}">${status}</span></div>
    <div class="mb-4">
      <div class="text-sm font-semibold text-slate-300 mb-1">Summary</div>
      <p class="text-sm text-slate-200">${escapeHtml(data.summary || "")}</p>
    </div>
    ${renderList("Customer Requirements", data.requirements)}
    ${renderList("Objections", data.objections)}
    ${renderList("Next Steps", data.nextSteps)}
    ${url ? `<div class="mt-4"><div class="text-sm font-semibold text-slate-300 mb-1">Recording</div><audio class="audio-player" controls src="${url}"></audio></div>` : ""}
  `;
  $("summaryModal").classList.remove("hidden");
}

function renderList(title, items) {
  if (!items || !items.length) return `<div class="mb-3"><div class="text-sm font-semibold text-slate-300 mb-1">${title}</div><p class="text-sm text-slate-500">None</p></div>`;
  return `<div class="mb-3"><div class="text-sm font-semibold text-slate-300 mb-1">${title}</div><ul class="list-disc list-inside text-sm text-slate-200 space-y-1">${items.map(i=>`<li>${escapeHtml(i)}</li>`).join("")}</ul></div>`;
}

// ---------- History ----------
async function refreshHistory() {
  const list = $("historyList");
  list.innerHTML = "";
  let calls = [];
  try { calls = await getAllCalls(); } catch(e) { calls = []; }
  if (!calls.length) {
    list.innerHTML = '<p class="text-slate-500 text-sm">No previous calls.</p>';
    return;
  }
  calls.forEach((c) => {
    const card = document.createElement("div");
    card.className = "card rounded-xl bg-slate-800/60 border border-slate-700 p-4";
    const url = c.audioBlob ? URL.createObjectURL(c.audioBlob) : null;
    card.innerHTML = `
      <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-2 mb-2">
        <div>
          <div class="font-semibold">${new Date(c.date).toLocaleString()}</div>
          <div class="text-xs text-slate-400">Duration: ${fmtTime(c.duration)} · Language: ${c.language || "en-US"}</div>
        </div>
        <span class="status-badge status-${c.status.replace(/ /g,'-')}">${c.status}</span>
      </div>
      <div class="text-sm text-slate-200 mb-2">${escapeHtml(c.summary || "")}</div>
      ${c.requirements?.length ? `<div class="text-xs text-slate-400 mb-1"><b>Requirements:</b> ${c.requirements.map(escapeHtml).join(", ")}</div>` : ""}
      ${c.objections?.length ? `<div class="text-xs text-slate-400 mb-1"><b>Objections:</b> ${c.objections.map(escapeHtml).join(", ")}</div>` : ""}
      ${c.nextSteps?.length ? `<div class="text-xs text-slate-400 mb-2"><b>Next steps:</b> ${c.nextSteps.map(escapeHtml).join(", ")}</div>` : ""}
      ${url ? `<audio class="audio-player" controls src="${url}"></audio>` : ""}
      <details class="mt-2">
        <summary class="cursor-pointer text-xs text-cyan-400">View transcript</summary>
        <div class="mt-2 space-y-1 text-sm">
          ${(c.transcript || []).map(m => `<div><span class="text-slate-500">${m.role === "assistant" ? "Bot" : "Customer"}:</span> ${escapeHtml(m.text)}</div>`).join("")}
        </div>
      </details>
    `;
    list.appendChild(card);
  });
}

// ---------- Settings UI ----------
function populateVoices() {
  getVoices().then((voices) => {
    const sel = $("sVoice");
    sel.innerHTML = "";
    const base = settings.language === "bilingual" ? "hi" : settings.language.split("-")[0];
    const filtered = voices.filter(v => v.lang.startsWith(base));
    const list = filtered.length ? filtered : voices;
    list.forEach(v => {
      const opt = document.createElement("option");
      opt.value = v.voiceURI;
      opt.textContent = `${v.name} (${v.lang})`;
      if (v.voiceURI === settings.voiceURI) opt.selected = true;
      sel.appendChild(opt);
    });
  });
}

function openSettings() {
  $("sProductName").value = settings.product.name;
  $("sProductDesc").value = settings.product.description;
  $("sProductPrice").value = settings.product.price;
  $("sLanguage").value = settings.language;
  $("sLlmEndpoint").value = settings.llmEndpoint;
  $("sLlmModel").value = settings.llmModel;
  $("sApiKey").value = settings.apiKey || "";
  populateVoices();
  $("settingsModal").classList.remove("hidden");
}

function saveSettingsFromUI() {
  settings.product.name = $("sProductName").value.trim() || DEFAULT_PRODUCT.name;
  settings.product.description = $("sProductDesc").value.trim() || DEFAULT_PRODUCT.description;
  settings.product.price = $("sProductPrice").value.trim() || DEFAULT_PRODUCT.price;
  settings.language = $("sLanguage").value;
  settings.voiceURI = $("sVoice").value;
  settings.llmEndpoint = $("sLlmEndpoint").value.trim() || DEFAULT_SETTINGS.llmEndpoint;
  settings.llmModel = $("sLlmModel").value.trim() || DEFAULT_SETTINGS.llmModel;
  settings.apiKey = $("sApiKey").value.trim();
  persistSettings();
  renderProductCard();
  $("settingsModal").classList.add("hidden");
}

// ---------- Mute ----------
function toggleMute() {
  if (!call) return;
  call.muted = !call.muted;
  call.stream.getAudioTracks().forEach(t => t.enabled = !call.muted);
  $("muteBtn").textContent = call.muted ? "🔇 Unmute" : "🎤 Mute";
}

// ---------- Init ----------
async function init() {
  renderProductCard();
  await refreshHistory();

  // consent banner initial
  $("consentAccept").addEventListener("click", () => {
    if (!$("consentCheck").checked) { alert("Please check the consent box."); return; }
    localStorage.setItem("salesbot_consent", "yes");
    $("consentBanner").classList.add("hidden");
    if (window._pendingStart) { const fn = window._pendingStart; window._pendingStart = null; fn(); }
  });
  if (localStorage.getItem("salesbot_consent") !== "yes") {
    $("consentBanner").classList.remove("hidden");
  }

  $("startCallBtn").addEventListener("click", startCall);
  $("endCallBtn").addEventListener("click", () => endCall(null));
  $("muteBtn").addEventListener("click", toggleMute);
  $("settingsBtn").addEventListener("click", openSettings);
  $("closeSettings").addEventListener("click", () => $("settingsModal").classList.add("hidden"));
  $("saveSettings").addEventListener("click", saveSettingsFromUI);
  $("sLanguage").addEventListener("change", () => { settings.language = $("sLanguage").value; populateVoices(); });
  $("closeSummary").addEventListener("click", () => $("summaryModal").classList.add("hidden"));

  $("historyTabBtn").addEventListener("click", () => {
    const v = $("historyView");
    v.classList.toggle("hidden");
    if (!v.classList.contains("hidden")) refreshHistory();
  });
  $("clearHistoryBtn").addEventListener("click", async () => {
    if (confirm("Delete all call history and recordings?")) {
      await deleteAllCalls();
      await refreshHistory();
    }
  });

  // voices load
  if (speechSynthesis.onvoiceschanged !== undefined) {
    speechSynthesis.onvoiceschanged = () => {};
  }
}

document.addEventListener("DOMContentLoaded", init);
