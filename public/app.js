const scenarioTitles = {
  bewerbung: 'Bewerbungsgespräch',
  sales: 'Sales-Pitch',
  gehalt: 'Gehaltsverhandlung'
};

const cards = document.querySelectorAll('.scenario-card');
const detailPanel = document.getElementById('detail');
const detailTitle = document.getElementById('detailTitle');
const chatLog = document.getElementById('chatLog');
const statusText = document.getElementById('statusText');
const chatForm = document.getElementById('chatForm');
const chatInput = document.getElementById('chatInput');
const micButton = document.getElementById('micButton');
const speakToggle = document.getElementById('speakToggle');
const backButton = document.getElementById('backButton');
const scenarioGrid = document.querySelector('.scenario-grid');
const analyzeButton = document.getElementById('analyzeButton');
const analysisPanel = document.getElementById('analysisPanel');
const analysisContent = document.getElementById('analysisContent');

let currentScenario = null;
let conversation = []; // { role: 'user' | 'assistant', content: string }
let isLoading = false;
let isAnalyzing = false;

function setStatus(text) {
  statusText.textContent = text || '';
}

function addBubble(role, text) {
  const bubble = document.createElement('div');
  bubble.className = `chat-bubble ${role === 'user' ? 'user' : 'ai'}`;
  bubble.textContent = text;
  chatLog.appendChild(bubble);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function speak(text) {
  if (!speakToggle.checked || !('speechSynthesis' in window)) return;

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'de-DE';

  const voices = window.speechSynthesis.getVoices();
  const germanVoice = voices.find((v) => v.lang && v.lang.startsWith('de'));
  if (germanVoice) utterance.voice = germanVoice;

  window.speechSynthesis.speak(utterance);
}

async function sendToServer() {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scenario: currentScenario, messages: conversation })
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Unbekannter Fehler bei der Kommunikation mit der KI.');
  }

  return data.reply;
}

async function requestAiReply() {
  isLoading = true;
  setStatus('Die KI denkt nach …');

  try {
    const reply = await sendToServer();
    conversation.push({ role: 'assistant', content: reply });
    addBubble('assistant', reply);
    speak(reply);
    setStatus('');
  } catch (err) {
    console.error(err);
    setStatus(err.message || 'Es ist ein Fehler aufgetreten.');
  } finally {
    isLoading = false;
  }
}

function startScenario(key) {
  currentScenario = key;
  conversation = [];
  chatLog.innerHTML = '';
  setStatus('');

  analysisPanel.classList.add('hidden');
  analysisContent.innerHTML = '';
  analyzeButton.disabled = true;

  detailTitle.textContent = scenarioTitles[key];
  detailPanel.classList.remove('hidden');
  scenarioGrid.classList.add('hidden');
  detailPanel.scrollIntoView({ behavior: 'smooth' });

  requestAiReply();
}

cards.forEach((card) => {
  card.addEventListener('click', () => {
    const key = card.dataset.scenario;
    if (scenarioTitles[key]) startScenario(key);
  });
});

backButton.addEventListener('click', () => {
  window.speechSynthesis && window.speechSynthesis.cancel();
  detailPanel.classList.add('hidden');
  scenarioGrid.classList.remove('hidden');
});

chatForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = chatInput.value.trim();
  if (!text || isLoading) return;

  conversation.push({ role: 'user', content: text });
  addBubble('user', text);
  chatInput.value = '';
  analyzeButton.disabled = false;

  requestAiReply();
});

// --- Gesprächsauswertung ---
function renderAnalysis(data) {
  analysisContent.innerHTML = '';

  const scoreBlock = document.createElement('div');
  scoreBlock.className = 'score-block';

  const scoreCircle = document.createElement('div');
  scoreCircle.className = 'score-circle';
  scoreCircle.textContent = `${data.gesamtscore}`;

  const scoreLabel = document.createElement('div');
  scoreLabel.className = 'score-label';
  scoreLabel.textContent = 'Gesamtscore von 0 bis 100';

  scoreBlock.appendChild(scoreCircle);
  scoreBlock.appendChild(scoreLabel);
  analysisContent.appendChild(scoreBlock);

  const areasTitle = document.createElement('h4');
  areasTitle.className = 'analysis-section-title';
  areasTitle.textContent = 'Bewertung nach Bereichen';
  analysisContent.appendChild(areasTitle);

  (data.bereiche || []).forEach((bereich) => {
    const card = document.createElement('div');
    card.className = 'area-card';

    const name = document.createElement('h4');
    name.textContent = bereich.name;
    card.appendChild(name);

    const columns = document.createElement('div');
    columns.className = 'area-columns';

    const staerkenCol = document.createElement('div');
    const staerkenTitle = document.createElement('h5');
    staerkenTitle.textContent = 'Stärken';
    const staerkenList = document.createElement('ul');
    (bereich.staerken || []).forEach((s) => {
      const li = document.createElement('li');
      li.textContent = s;
      staerkenList.appendChild(li);
    });
    staerkenCol.appendChild(staerkenTitle);
    staerkenCol.appendChild(staerkenList);

    const verbCol = document.createElement('div');
    const verbTitle = document.createElement('h5');
    verbTitle.textContent = 'Verbesserungen';
    const verbList = document.createElement('ul');
    (bereich.verbesserungen || []).forEach((v) => {
      const li = document.createElement('li');
      li.textContent = v;
      verbList.appendChild(li);
    });
    verbCol.appendChild(verbTitle);
    verbCol.appendChild(verbList);

    columns.appendChild(staerkenCol);
    columns.appendChild(verbCol);
    card.appendChild(columns);
    analysisContent.appendChild(card);
  });

  const reformTitle = document.createElement('h4');
  reformTitle.className = 'analysis-section-title';
  reformTitle.textContent = 'Konkrete Umformulierungen';
  analysisContent.appendChild(reformTitle);

  (data.umformulierungen || []).forEach((item) => {
    const card = document.createElement('div');
    card.className = 'reformulation-card';

    const original = document.createElement('p');
    original.className = 'original';
    const originalLabel = document.createElement('span');
    originalLabel.textContent = 'Original:';
    original.appendChild(originalLabel);
    original.appendChild(document.createTextNode(item.original));

    const improved = document.createElement('p');
    improved.className = 'improved';
    const improvedLabel = document.createElement('span');
    improvedLabel.textContent = 'Besser:';
    improved.appendChild(improvedLabel);
    improved.appendChild(document.createTextNode(item.verbesserung));

    card.appendChild(original);
    card.appendChild(improved);
    analysisContent.appendChild(card);
  });

  const stepsTitle = document.createElement('h4');
  stepsTitle.className = 'analysis-section-title';
  stepsTitle.textContent = 'Nächste Übungsschritte';
  analysisContent.appendChild(stepsTitle);

  const stepsList = document.createElement('ol');
  stepsList.className = 'next-steps-list';
  (data.naechste_schritte || []).forEach((step) => {
    const li = document.createElement('li');
    li.textContent = step;
    stepsList.appendChild(li);
  });
  analysisContent.appendChild(stepsList);

  analysisPanel.classList.remove('hidden');
  analysisPanel.scrollIntoView({ behavior: 'smooth' });
}

analyzeButton.addEventListener('click', async () => {
  if (isAnalyzing || analyzeButton.disabled) return;

  isAnalyzing = true;
  analyzeButton.disabled = true;
  analyzeButton.textContent = 'Werte aus …';
  setStatus('');

  try {
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenario: currentScenario, messages: conversation })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Die Auswertung konnte nicht erstellt werden.');
    }

    renderAnalysis(data);
  } catch (err) {
    console.error(err);
    setStatus(err.message || 'Es ist ein Fehler bei der Auswertung aufgetreten.');
  } finally {
    isAnalyzing = false;
    analyzeButton.disabled = false;
    analyzeButton.textContent = 'Gespräch auswerten';
  }
});

// --- Spracheingabe (Mikrofon) ---
const SpeechRecognitionImpl = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let isRecording = false;

if (SpeechRecognitionImpl) {
  recognition = new SpeechRecognitionImpl();
  recognition.lang = 'de-DE';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  recognition.addEventListener('result', (event) => {
    const transcript = event.results[0][0].transcript;
    chatInput.value = transcript;
  });

  recognition.addEventListener('end', () => {
    isRecording = false;
    micButton.classList.remove('recording');
  });

  recognition.addEventListener('error', () => {
    isRecording = false;
    micButton.classList.remove('recording');
    setStatus('Spracherkennung war nicht erfolgreich. Bitte versuche es erneut oder tippe deine Antwort.');
  });

  micButton.addEventListener('click', () => {
    if (isRecording) {
      recognition.stop();
      return;
    }
    isRecording = true;
    micButton.classList.add('recording');
    setStatus('Ich höre zu …');
    recognition.start();
  });
} else {
  micButton.disabled = true;
  micButton.title = 'Spracherkennung wird von diesem Browser nicht unterstützt.';
}
