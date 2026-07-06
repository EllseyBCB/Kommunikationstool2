require('dotenv').config();

const express = require('express');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const prompts = require('./server/prompts');

const app = express();
const PORT = process.env.PORT || 3000;
const MODEL = 'claude-sonnet-5';
const MAX_HISTORY_MESSAGES = 60;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MAX_TTS_TEXT_LENGTH = 2000;
const ELEVENLABS_MODEL_ID = 'eleven_multilingual_v2';

const ANALYSIS_TOOL = {
  name: 'liefere_sprachanalyse',
  description: 'Liefert die strukturierte D+J-Sprachanalyse der übenden Person.',
  input_schema: {
    type: 'object',
    properties: {
      gesamtscore: {
        type: 'integer',
        minimum: 0,
        maximum: 100,
        description: 'Gesamtscore von 0 bis 100 für die gesamte Kommunikation der Person.'
      },
      dimensionen: {
        type: 'array',
        minItems: prompts.DIMENSIONS.length,
        maxItems: prompts.DIMENSIONS.length,
        description: 'Genau ein Eintrag pro Dimension, in der vorgegebenen Reihenfolge.',
        items: {
          type: 'object',
          properties: {
            schluessel: { type: 'string', enum: prompts.DIMENSIONS.map((d) => d.key) },
            score: { type: 'integer', minimum: 0, maximum: 100 },
            staerken: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 3 },
            entwicklungsfelder: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 3 },
            tipps: {
              type: 'array',
              minItems: 1,
              maxItems: 2,
              items: {
                type: 'object',
                properties: {
                  tipp: { type: 'string' },
                  uebung: { type: 'string' }
                },
                required: ['tipp', 'uebung']
              }
            }
          },
          required: ['schluessel', 'score', 'staerken', 'entwicklungsfelder', 'tipps']
        }
      },
      top_staerken: {
        type: 'array',
        minItems: 3,
        maxItems: 3,
        items: { type: 'string' }
      },
      prioritaere_entwicklungsfelder: {
        type: 'array',
        minItems: 1,
        maxItems: 2,
        items: {
          type: 'object',
          properties: {
            feld: { type: 'string' },
            massnahme: { type: 'string' }
          },
          required: ['feld', 'massnahme']
        }
      },
      zusammenfassung: { type: 'string' },
      naechste_schritte: {
        type: 'array',
        minItems: 3,
        maxItems: 3,
        items: { type: 'string' }
      }
    },
    required: ['gesamtscore', 'dimensionen', 'top_staerken', 'prioritaere_entwicklungsfelder', 'zusammenfassung', 'naechste_schritte']
  }
};

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function cleanConversation(messages) {
  const history = Array.isArray(messages) ? messages : [];
  return history
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-MAX_HISTORY_MESSAGES)
    .map((m) => ({ role: m.role, content: m.content }));
}

app.post('/api/chat', async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'Auf dem Server ist kein ANTHROPIC_API_KEY konfiguriert.' });
  }

  const { messages, elapsedSeconds } = req.body || {};
  const cleanHistory = cleanConversation(messages);
  const safeElapsed = Number.isFinite(elapsedSeconds) ? Math.max(0, elapsedSeconds) : 0;

  const apiMessages = cleanHistory.length > 0
    ? cleanHistory
    : [{ role: 'user', content: 'Bitte begrüße mich und beginne das Gespräch.' }];

  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 400,
      system: prompts.buildConversationSystemPrompt(safeElapsed),
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

app.post('/api/analyze', async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'Auf dem Server ist kein ANTHROPIC_API_KEY konfiguriert.' });
  }

  const { messages } = req.body || {};
  const cleanHistory = cleanConversation(messages);
  const userTurns = cleanHistory.filter((m) => m.role === 'user');

  if (userTurns.length === 0) {
    return res.status(400).json({ error: 'Es gibt noch keinen Gesprächsverlauf zum Auswerten.' });
  }

  const transcript = cleanHistory
    .map((m) => `${m.role === 'user' ? 'Übende Person' : 'D+J SprachCoach'}: ${m.content}`)
    .join('\n\n');

  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system: prompts.buildAnalysisSystemPrompt(),
      tools: [ANALYSIS_TOOL],
      tool_choice: { type: 'tool', name: ANALYSIS_TOOL.name },
      messages: [
        {
          role: 'user',
          content: `Hier ist das vollständige Gesprächstranskript:\n\n${transcript}\n\nBitte erstelle die strukturierte Sprachanalyse ausschließlich für die „Übende Person".`
        }
      ]
    });

    if (response.stop_reason === 'max_tokens') {
      throw new Error('Die Antwort der KI wurde abgeschnitten (zu lang für das Token-Limit).');
    }

    const toolUse = response.content.find((block) => block.type === 'tool_use' && block.name === ANALYSIS_TOOL.name);

    if (!toolUse) {
      throw new Error('Keine strukturierte Auswertung erhalten.');
    }

    const result = toolUse.input;
    const hasValidShape = result
      && typeof result.gesamtscore === 'number'
      && Array.isArray(result.dimensionen)
      && result.dimensionen.length === prompts.DIMENSIONS.length
      && Array.isArray(result.top_staerken)
      && Array.isArray(result.naechste_schritte);

    if (!hasValidShape) {
      throw new Error('Die Auswertung war unvollständig.');
    }

    res.json({ dimensionMeta: prompts.DIMENSIONS, ...result });
  } catch (err) {
    console.error('Fehler beim Aufruf der Anthropic-API:', err);
    res.status(502).json({ error: 'Die Analyse konnte gerade nicht vollständig erstellt werden. Bitte versuche es erneut.' });
  }
});

app.post('/api/tts', async (req, res) => {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;

  if (!apiKey || !voiceId) {
    return res.status(500).json({ error: 'ElevenLabs ist auf dem Server nicht konfiguriert.' });
  }

  const { text } = req.body || {};
  const cleanText = typeof text === 'string' ? text.trim().slice(0, MAX_TTS_TEXT_LENGTH) : '';

  if (!cleanText) {
    return res.status(400).json({ error: 'Kein Text zum Vorlesen übergeben.' });
  }

  try {
    const elevenResponse = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': apiKey,
          Accept: 'audio/mpeg'
        },
        body: JSON.stringify({
          text: cleanText,
          model_id: ELEVENLABS_MODEL_ID,
          voice_settings: { stability: 0.5, similarity_boost: 0.75 }
        })
      }
    );

    if (!elevenResponse.ok) {
      const errText = await elevenResponse.text();
      console.error('ElevenLabs-Fehler:', elevenResponse.status, errText);
      return res.status(502).json({ error: 'Die Sprachausgabe konnte nicht erstellt werden.' });
    }

    const audioBuffer = Buffer.from(await elevenResponse.arrayBuffer());
    res.set('Content-Type', 'audio/mpeg');
    res.send(audioBuffer);
  } catch (err) {
    console.error('Fehler beim Aufruf von ElevenLabs:', err);
    res.status(502).json({ error: 'Die Sprachausgabe konnte nicht erstellt werden.' });
  }
});

app.listen(PORT, () => {
  console.log(`D+J SprachCoach läuft auf http://localhost:${PORT}`);
});
