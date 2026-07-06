// --- DOM-Referenzen ---
const homeSection = document.getElementById('home');
const conversationSection = document.getElementById('conversation');
const analysisSection = document.getElementById('analysis');

const consentCheckbox = document.getElementById('consentCheckbox');
const startButton = document.getElementById('startButton');
const homeStatus = document.getElementById('homeStatus');

const waveformBars = Array.from(document.querySelectorAll('#waveform span'));
const convStatus = document.getElementById('convStatus');
const timerDisplay = document.getElementById('timerDisplay');
const micButton = document.getElementById('micButton');
const endButton = document.getElementById('endButton');
const transcriptToggle = document.getElementById('transcriptToggle');
const chatLog = document.getElementById('chatLog');

const overallScoreCircle = document.getElementById('overallScoreCircle');
const overallScoreCategory = document.getElementById('overallScoreCategory');
const dimensionOverview = document.getElementById('dimensionOverview');
const dimensionDetails = document.getElementById('dimensionDetails');
const topStrengths = document.getElementById('topStrengths');
const priorityAreas = document.getElementById('priorityAreas');
const summaryText = document.getElementById('summaryText');
const nextStepsList = document.getElementById('nextStepsList');
const exportPdfButton = document.getElementById('exportPdfButton');
const newConversationButton = document.getElementById('newConversationButton');

const MIN_CONVERSATION_SECONDS = 300;

// --- Zustand ---
let conversation = []; // { role: 'user' | 'assistant', content: string }
let elapsedSeconds = 0;
let timerInterval = null;
let isLoading = false;
let isRecording = false;
let isSpeaking = false;

let audioContext = null;
let analyserNode = null;
let waveformDataArray = null;
let waveformRAF = null;

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function scoreCategory(score) {
  if (score >= 90) return 'Exzellent';
  if (score >= 80) return 'Sehr gut';
  if (score >= 70) return 'Gut';
  if (score >= 60) return 'Befriedigend';
  if (score >= 50) return 'Ausbaufähig';
  return 'Intensivförderung';
}

function starString(score) {
  const filled = Math.max(1, Math.min(5, Math.round(score / 20)));
  return '★'.repeat(filled) + '☆'.repeat(5 - filled);
}

// --- Startseite ---
consentCheckbox.addEventListener('change', () => {
  startButton.disabled = !consentCheckbox.checked;
});

startButton.addEventListener('click', async () => {
  startButton.disabled = true;
  homeStatus.textContent = 'Mikrofonzugriff wird angefragt …';

  const micOk = await setupAudioAnalysis();
  if (!micOk) {
    homeStatus.textContent = 'Ohne Mikrofonzugriff kann das Gespräch nicht gestartet werden. Bitte erlaube den Zugriff und versuche es erneut.';
    startButton.disabled = false;
    return;
  }

  homeStatus.textContent = '';
  homeSection.classList.add('hidden');
  conversationSection.classList.remove('hidden');

  startWaveformLoop();
  startTimer();
  requestAiReply();
});

// --- Mikrofon-Analyse (Web Audio API) für die Wellenform ---
async function setupAudioAnalysis() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const AudioContextImpl = window.AudioContext || window.webkitAudioContext;
    audioContext = new AudioContextImpl();
    const source = audioContext.createMediaStreamSource(stream);
    analyserNode = audioContext.createAnalyser();
    analyserNode.fftSize = 256;
    source.connect(analyserNode);
    waveformDataArray = new Uint8Array(analyserNode.fftSize);
    return true;
  } catch (err) {
    console.error('Mikrofonzugriff fehlgeschlagen:', err);
    return false;
  }
}

function setWaveformIntensity(intensity) {
  waveformBars.forEach((bar) => {
    const variance = 0.6 + Math.random() * 0.5;
    const height = Math.max(6, Math.min(40, intensity * 40 * variance));
    bar.style.height = `${height}px`;
  });
}

function startWaveformLoop() {
  function loop() {
    if (isRecording && analyserNode && waveformDataArray) {
      analyserNode.getByteTimeDomainData(waveformDataArray);
      let sum = 0;
      for (let i = 0; i < waveformDataArray.length; i++) {
        const v = (waveformDataArray[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / waveformDataArray.length);
      setWaveformIntensity(rms * 3);
    } else if (isSpeaking) {
      setWaveformIntensity(0.35 + Math.random() * 0.3);
    } else {
      setWaveformIntensity(0.08);
    }
    waveformRAF = requestAnimationFrame(loop);
  }
  loop();
}

function stopWaveformLoop() {
  if (waveformRAF) cancelAnimationFrame(waveformRAF);
  waveformRAF = null;
}

// --- Timer ---
function startTimer() {
  elapsedSeconds = 0;
  timerDisplay.textContent = formatTime(0);
  timerInterval = setInterval(() => {
    elapsedSeconds += 1;
    timerDisplay.textContent = formatTime(elapsedSeconds);
    if (elapsedSeconds >= MIN_CONVERSATION_SECONDS) {
      endButton.disabled = false;
    }
  }, 1000);
}

function stopTimer() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = null;
}

// --- Chat / TTS ---
function addBubble(role, text) {
  const bubble = document.createElement('div');
  bubble.className = `chat-bubble ${role === 'user' ? 'user' : 'ai'}`;
  bubble.textContent = text;
  chatLog.appendChild(bubble);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function speak(text) {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window)) {
      resolve();
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'de-DE';

    const voices = window.speechSynthesis.getVoices();
    const germanVoice = voices.find((v) => v.lang && v.lang.startsWith('de'));
    if (germanVoice) utterance.voice = germanVoice;

    isSpeaking = true;
    convStatus.textContent = 'Ich spreche …';

    utterance.onend = () => {
      isSpeaking = false;
      resolve();
    };
    utterance.onerror = () => {
      isSpeaking = false;
      resolve();
    };

    window.speechSynthesis.speak(utterance);
  });
}

async function requestAiReply() {
  isLoading = true;
  micButton.disabled = true;
  convStatus.textContent = 'D+J SprachCoach denkt nach …';

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: conversation, elapsedSeconds })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Unbekannter Fehler bei der Kommunikation mit der KI.');
    }

    conversation.push({ role: 'assistant', content: data.reply });
    addBubble('assistant', data.reply);
    await speak(data.reply);
    convStatus.textContent = 'Ich höre zu …';
  } catch (err) {
    console.error(err);
    convStatus.textContent = err.message || 'Es ist ein Fehler aufgetreten.';
  } finally {
    isLoading = false;
    micButton.disabled = false;
  }
}

// --- Spracheingabe (Mikrofon) ---
const SpeechRecognitionImpl = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;

if (SpeechRecognitionImpl) {
  recognition = new SpeechRecognitionImpl();
  recognition.lang = 'de-DE';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  recognition.addEventListener('result', (event) => {
    const transcript = event.results[0][0].transcript;
    if (!transcript) return;
    conversation.push({ role: 'user', content: transcript });
    addBubble('user', transcript);
    requestAiReply();
  });

  recognition.addEventListener('end', () => {
    isRecording = false;
    micButton.classList.remove('recording');
    micButton.textContent = '🎤 Sprechen';
  });

  recognition.addEventListener('error', () => {
    isRecording = false;
    micButton.classList.remove('recording');
    micButton.textContent = '🎤 Sprechen';
    convStatus.textContent = 'Spracherkennung war nicht erfolgreich. Bitte versuche es erneut.';
  });

  micButton.addEventListener('click', () => {
    if (isLoading || isSpeaking) return;

    if (isRecording) {
      recognition.stop();
      return;
    }

    isRecording = true;
    micButton.classList.add('recording');
    micButton.textContent = '⏺ Höre zu …';
    convStatus.textContent = 'Ich höre zu …';
    recognition.start();
  });
} else {
  micButton.disabled = true;
  micButton.title = 'Spracherkennung wird von diesem Browser nicht unterstützt.';
}

transcriptToggle.addEventListener('change', () => {
  chatLog.classList.toggle('hidden', !transcriptToggle.checked);
});

// --- Gespräch beenden & Analyse ---
endButton.addEventListener('click', async () => {
  if (endButton.disabled) return;

  endButton.disabled = true;
  micButton.disabled = true;
  window.speechSynthesis && window.speechSynthesis.cancel();
  if (recognition && isRecording) recognition.stop();

  stopTimer();
  stopWaveformLoop();

  conversationSection.classList.add('hidden');
  analysisSection.classList.remove('hidden');
  analysisSection.scrollIntoView({ behavior: 'smooth' });

  overallScoreCircle.textContent = '…';
  overallScoreCategory.textContent = 'Die Analyse wird erstellt …';
  dimensionOverview.innerHTML = '';
  dimensionDetails.innerHTML = '';
  topStrengths.innerHTML = '';
  priorityAreas.innerHTML = '';
  summaryText.textContent = '';
  nextStepsList.innerHTML = '';

  try {
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: conversation })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Die Analyse konnte nicht erstellt werden.');
    }

    renderAnalysis(data);
  } catch (err) {
    console.error(err);
    overallScoreCategory.textContent = err.message || 'Es ist ein Fehler bei der Analyse aufgetreten.';
  }
});

function renderAnalysis(data) {
  const metaByKey = {};
  (data.dimensionMeta || []).forEach((m) => { metaByKey[m.key] = m; });

  overallScoreCircle.textContent = `${data.gesamtscore}`;
  overallScoreCategory.textContent = `${scoreCategory(data.gesamtscore)} (${data.gesamtscore}/100)`;

  (data.dimensionen || []).forEach((dim) => {
    const meta = metaByKey[dim.schluessel] || { name: dim.schluessel, textBased: false };

    // Übersichtszeile
    const row = document.createElement('div');
    row.className = 'dim-row';

    const name = document.createElement('div');
    name.className = 'dim-row-name';
    name.textContent = meta.name;

    const track = document.createElement('div');
    track.className = 'dim-bar-track';
    const fill = document.createElement('div');
    fill.className = 'dim-bar-fill';
    fill.style.width = `${dim.score}%`;
    track.appendChild(fill);

    const scoreEl = document.createElement('div');
    scoreEl.className = 'dim-row-score';
    scoreEl.textContent = `${dim.score}/100`;

    row.appendChild(name);
    row.appendChild(track);
    row.appendChild(scoreEl);
    dimensionOverview.appendChild(row);

    // Detailkarte
    const card = document.createElement('details');
    card.className = 'dim-card';

    const summary = document.createElement('summary');
    summary.textContent = meta.name;
    if (meta.textBased) {
      const badge = document.createElement('span');
      badge.className = 'text-based-badge';
      badge.textContent = 'textbasierte Schätzung';
      summary.appendChild(badge);
    }
    card.appendChild(summary);

    const metaLine = document.createElement('p');
    metaLine.className = 'dim-card-meta';
    metaLine.textContent = `${dim.score}/100 · ${starString(dim.score)}`;
    card.appendChild(metaLine);

    const staerkenTitle = document.createElement('h4');
    staerkenTitle.textContent = '✅ Stärken';
    card.appendChild(staerkenTitle);
    const staerkenList = document.createElement('ul');
    (dim.staerken || []).forEach((s) => {
      const li = document.createElement('li');
      li.textContent = s;
      staerkenList.appendChild(li);
    });
    card.appendChild(staerkenList);

    const entwTitle = document.createElement('h4');
    entwTitle.textContent = '⚠️ Entwicklungsfelder';
    card.appendChild(entwTitle);
    const entwList = document.createElement('ul');
    (dim.entwicklungsfelder || []).forEach((e) => {
      const li = document.createElement('li');
      li.textContent = e;
      entwList.appendChild(li);
    });
    card.appendChild(entwList);

    const tippsTitle = document.createElement('h4');
    tippsTitle.textContent = '💡 Verbesserungsvorschläge';
    card.appendChild(tippsTitle);
    (dim.tipps || []).forEach((t) => {
      const p = document.createElement('p');
      p.className = 'tip-item';
      p.textContent = t.tipp;
      const ex = document.createElement('span');
      ex.className = 'exercise';
      ex.textContent = `→ Übung: ${t.uebung}`;
      p.appendChild(ex);
      card.appendChild(p);
    });

    dimensionDetails.appendChild(card);
  });

  (data.top_staerken || []).forEach((s) => {
    const li = document.createElement('li');
    li.textContent = s;
    topStrengths.appendChild(li);
  });

  (data.prioritaere_entwicklungsfelder || []).forEach((p) => {
    const card = document.createElement('div');
    card.className = 'priority-card';
    const field = document.createElement('div');
    field.className = 'field';
    field.textContent = p.feld;
    const measure = document.createElement('div');
    measure.className = 'measure';
    measure.textContent = `→ Empfohlene Maßnahme: ${p.massnahme}`;
    card.appendChild(field);
    card.appendChild(measure);
    priorityAreas.appendChild(card);
  });

  summaryText.textContent = data.zusammenfassung || '';

  (data.naechste_schritte || []).forEach((step) => {
    const li = document.createElement('li');
    li.textContent = step;
    nextStepsList.appendChild(li);
  });
}

exportPdfButton.addEventListener('click', () => {
  window.print();
});

newConversationButton.addEventListener('click', () => {
  conversation = [];
  elapsedSeconds = 0;
  endButton.disabled = true;
  micButton.textContent = '🎤 Sprechen';
  chatLog.innerHTML = '';
  transcriptToggle.checked = false;
  chatLog.classList.add('hidden');
  consentCheckbox.checked = false;
  startButton.disabled = true;
  homeStatus.textContent = '';

  analysisSection.classList.add('hidden');
  homeSection.classList.remove('hidden');
  homeSection.scrollIntoView({ behavior: 'smooth' });
});
