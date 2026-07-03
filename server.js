require('dotenv').config();

const express = require('express');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const prompts = require('./server/prompts');

const app = express();
const PORT = process.env.PORT || 3000;
const MODEL = 'claude-sonnet-5';
const MAX_HISTORY_MESSAGES = 40;
const MAX_DETAIL_FIELD_LENGTH = 4000;
const SCENARIO_KEYS = ['bewerbung', 'sales', 'gehalt'];

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const ANALYSIS_TOOL = {
  name: 'liefere_auswertung',
  description: 'Liefert eine strukturierte Auswertung der Kommunikation der übenden Person.',
  input_schema: {
    type: 'object',
    properties: {
      gesamtscore: {
        type: 'integer',
        minimum: 0,
        maximum: 100,
        description: 'Gesamtscore von 0 bis 100 für die Kommunikation der übenden Person.'
      },
      bereiche: {
        type: 'array',
        minItems: 5,
        maxItems: 5,
        description: 'Genau ein Eintrag pro Bewertungsbereich, in der vorgegebenen Reihenfolge.',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', enum: prompts.ANALYSIS_AREAS },
            staerken: {
              type: 'array',
              items: { type: 'string' },
              minItems: 1,
              maxItems: 3
            },
            verbesserungen: {
              type: 'array',
              items: { type: 'string' },
              minItems: 1,
              maxItems: 3
            }
          },
          required: ['name', 'staerken', 'verbesserungen']
        }
      },
      umformulierungen: {
        type: 'array',
        minItems: 2,
        maxItems: 3,
        items: {
          type: 'object',
          properties: {
            original: { type: 'string', description: 'Originale Formulierung der übenden Person.' },
            verbesserung: { type: 'string', description: 'Verbesserte Umformulierung.' }
          },
          required: ['original', 'verbesserung']
        }
      },
      naechste_schritte: {
        type: 'array',
        minItems: 3,
        maxItems: 3,
        items: { type: 'string' }
      }
    },
    required: ['gesamtscore', 'bereiche', 'umformulierungen', 'naechste_schritte']
  }
};

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function trimField(value) {
  return typeof value === 'string' ? value.trim().slice(0, MAX_DETAIL_FIELD_LENGTH) : '';
}

function getScenarioConfig(scenario, details) {
  if (!SCENARIO_KEYS.includes(scenario)) return null;

  const config = prompts[scenario];

  if (typeof config.buildSystem === 'function') {
    const cleanDetails = {
      jobTitle: trimField(details && details.jobTitle),
      jobInfo: trimField(details && details.jobInfo)
    };
    return { title: config.title, system: config.buildSystem(cleanDetails) };
  }

  return config;
}

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

  const { scenario, messages, details } = req.body || {};
  const scenarioConfig = getScenarioConfig(scenario, details);

  if (!scenarioConfig) {
    return res.status(400).json({ error: 'Unbekanntes Szenario.' });
  }

  const cleanHistory = cleanConversation(messages);

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

app.post('/api/analyze', async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'Auf dem Server ist kein ANTHROPIC_API_KEY konfiguriert.' });
  }

  const { scenario, messages, details } = req.body || {};
  const scenarioConfig = getScenarioConfig(scenario, details);

  if (!scenarioConfig) {
    return res.status(400).json({ error: 'Unbekanntes Szenario.' });
  }

  const cleanHistory = cleanConversation(messages);
  const userTurns = cleanHistory.filter((m) => m.role === 'user');

  if (userTurns.length === 0) {
    return res.status(400).json({ error: 'Es gibt noch keinen Gesprächsverlauf zum Auswerten.' });
  }

  const transcript = cleanHistory
    .map((m) => `${m.role === 'user' ? 'Übende Person' : 'Gesprächspartner (Rolle)'}: ${m.content}`)
    .join('\n\n');

  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system: prompts.buildAnalysisSystemPrompt(scenarioConfig.title),
      tools: [ANALYSIS_TOOL],
      tool_choice: { type: 'tool', name: ANALYSIS_TOOL.name },
      messages: [
        {
          role: 'user',
          content: `Hier ist der vollständige Gesprächsverlauf:\n\n${transcript}\n\nBitte werte ausschließlich die Kommunikation der „Übenden Person" aus.`
        }
      ]
    });

    const toolUse = response.content.find((block) => block.type === 'tool_use' && block.name === ANALYSIS_TOOL.name);

    if (!toolUse) {
      throw new Error('Keine strukturierte Auswertung erhalten.');
    }

    res.json(toolUse.input);
  } catch (err) {
    console.error('Fehler beim Aufruf der Anthropic-API:', err);
    res.status(502).json({ error: 'Die Auswertung konnte gerade nicht erstellt werden. Bitte versuche es erneut.' });
  }
});

app.listen(PORT, () => {
  console.log(`Kommunikationstool läuft auf http://localhost:${PORT}`);
});
