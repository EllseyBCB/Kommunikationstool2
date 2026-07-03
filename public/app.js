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

let currentScenario = null;
let conversation = []; // { role: 'user' | 'assistant', content: string }
let isLoading = false;

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

  requestAiReply();
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
