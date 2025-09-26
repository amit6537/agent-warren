// src/mastra/index.ts
import 'dotenv/config';
import express from 'express';
import { Agent, createTool } from '@mastra/core';
import { LibSQLStore } from '@mastra/libsql';
import { openai } from '@ai-sdk/openai';
import { embed as aiEmbed } from 'ai';
import { z } from 'zod';
import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';

const DB_URL = process.env.DB_FILE ?? 'file:mastra.db';

// Create Express app instance
const app = express();
app.use(express.json());

// --- 1. SEARCH TOOL ---
const searchTool = createTool({
  id: 'search_berkshire_letters',
  description: 'Searches the Berkshire Hathaway shareholder letters for relevant information on a given query.',
  inputSchema: z.object({
    query: z.string().describe('The search query to find relevant context.'),
  }),
  execute: async (context) => {
    const { input } = context;
    console.log(`Tool executing with query: "${input.query}"`);

    // Connect to the local file DB
    const vectorStore = new LibSQLStore({ url: DB_URL });

    // Create embedding (handle common SDK shapes)
    let embedding: number[] | undefined;
    try {
      // try 'ai' style
      const embedResp = await aiEmbed({
        model: openai.embedding ? openai.embedding('text-embedding-3-small') : 'text-embedding-3-small',
        value: input.query,
      } as any);

      // many libs return { embedding } or { data: [{ embedding }] }
      if ((embedResp as any).embedding) embedding = (embedResp as any).embedding as number[];
      else if ((embedResp as any).data && Array.isArray((embedResp as any).data) && (embedResp as any).data[0].embedding)
        embedding = (embedResp as any).data[0].embedding as number[];
      else throw new Error('Unknown embedding response shape: ' + JSON.stringify(Object.keys(embedResp)));
    } catch (err) {
      console.error('Embedding failed:', err);
      throw err;
    }

    // Query the vector store for top K results
    const results = await vectorStore.query({
      collection: 'berkshire_hathaway_letters',
      embedding,
      topK: 5,
    });
    console.log('Search results count:', results.length);
    // Inspect shape when debugging:
    // console.log(JSON.stringify(results, null, 2));

    // Format context safely
    const contextText = results
      .map((r) => {
        const meta = (r as any).metadata ?? {};
        const src = meta.source ?? meta.file ?? meta.filename ?? 'unknown';
        const text = meta.text ?? r.content ?? r.document ?? 'no-text';
        return `Source: ${src}\nContent: ${text}`;
      })
      .join('\n\n---\n\n');

    return contextText;
  },
});

// --- 2. AGENT ---
const financialAnalystAgent = new Agent({
  name: 'FinancialAnalystAgent',
  instructions: `
    You are a knowledgeable financial analyst specializing in Warren Buffett's investment philosophy and Berkshire Hathaway's business strategy.
    Use only the provided shareholder letter content. Quote with citations when possible.
  `,
  model: openai('gpt-4o'),
  tools: {
    search_berkshire_letters: searchTool,
  },
});

// const embedResp = await aiEmbed({
//   model: openai.embedding('text-embedding-3-small'),  // <-- use openai
//   value: '', // Removed undefined 'input' reference
// } as any);

// --- 3. MASTRA INSTANCE ---
export const mastra = new Mastra({
  agents: { financialAnalystAgent },
  storage: new LibSQLStore({ url: DB_URL }),
  logger: new PinoLogger({ name: 'Mastra', level: 'info' }),
});

// --- 4. SERVER ---
// const app = express();
app.use(express.json());

async function getAnswerFromAgent(agent: any, question: string): Promise<string> {
  // Preferred: non-streaming vNext
  if (typeof agent.generateVNext === 'function') {
    const r = await agent.generateVNext(question);
    return r?.text ?? r?.output ?? (typeof r === 'string' ? r : JSON.stringify(r));
  }
  // Fallback: stream vNext, buffer to a single string
  if (typeof agent.streamVNext === 'function') {
    const sr = await agent.streamVNext(question);
    let buf = '';
    for await (const chunk of sr.stream) {
      buf += (chunk?.delta?.content ?? chunk?.content ?? (typeof chunk === 'string' ? chunk : ''));
    }
    return buf || 'No content returned from stream.';
  }
  // Last resorts (older APIs)
  if (typeof agent.generateLegacy === 'function') {
    const r = await agent.generateLegacy(question);
    return r?.text ?? r?.output ?? (typeof r === 'string' ? r : JSON.stringify(r));
  }
  if (typeof agent.streamLegacy === 'function') {
    const sr = await agent.streamLegacy(question);
    let buf = '';
    for await (const chunk of sr.stream) {
      buf += (chunk?.delta?.content ?? chunk?.content ?? (typeof chunk === 'string' ? chunk : ''));
    }
    return buf || 'No content returned from stream.';
  }
  throw new Error('No compatible method found on Agent.');
}
app.post('/ask', async (req, res) => {
  const { question } = req.body;
  if (!question) return res.status(400).json({ error: 'Question is required.' });

  console.log(`\nReceived question: "${question}"`);
  try {
    const answer = await getAnswerFromAgent(financialAnalystAgent as any, question);
    res.status(200).json({ answer });
  } catch (error) {
    console.error('Error processing request:', error);
    res.status(500).json({ error: 'Failed to get response from agent.' });
  }
});

// ✅ Force port 3000
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`✅ Express server is running at http://localhost:${PORT}/ask`);
});