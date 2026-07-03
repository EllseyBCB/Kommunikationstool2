require('dotenv').config();

const express = require('express');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const prompts = require('./server/prompts');

const app = express();
const PORT = process.env.PORT || 3000;
const MODEL = 'claude-sonnet-5';
const MAX_HISTORY_MESSAGES = 40;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/chat', async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'Auf dem Server ist kein ANTHROPIC_API_KEY konfiguriert.' });
  }

  const { scenario, messages } = req.body || {};
  const scenarioConfig = prompts[scenario];

  if (!scenarioConfig) {
    return res.status(400).json({ error: 'Unbekanntes Szenario.' });
  }

  const history = Array.isArray(messages) ? messages : [];
  const cleanHistory = history
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-MAX_HISTORY_MESSAGES)
    .map((m) => ({ role: m.role, content: m.content }));

  const apiMessages = cleanHistory.length > 0
    ? cleanHistory
    : [{ role: 'user', content: 'Bitte beginne das Rollenspiel mit deiner ersten Begrüßung bzw. Frage.' }];

  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 400,
      system: scenarioConfig.system,
      messages: apiMessages
    });

    const reply = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim();

    res.json({ reply });
  } catch (err) {
    console.error('Fehler beim Aufruf der Anthropic-API:', err);
    res.status(502).json({ error: 'Die KI konnte gerade nicht antworten. Bitte versuche es erneut.' });
  }
});

app.listen(PORT, () => {
  console.log(`Kommunikationstool läuft auf http://localhost:${PORT}`);
});
