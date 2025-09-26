// server/ingest.js
require('dotenv').config(); // load .env at the very top
console.log('OPENAI_API_KEY loaded?', !!process.env.OPENAI_API_KEY);
console.log('OPENAI_API_KEY preview:', JSON.stringify(process.env.OPENAI_API_KEY?.slice(0,8)));


const { MDocument } = require("@mastra/rag");
const { LibSQLStore } = require("@mastra/libsql");
const { embedMany } = require("ai");
const { openai } = require("@ai-sdk/openai");
const fs = require("fs/promises");
const path = require("path");
const pdf = require("pdf-parse");

// Config from .env (use sensible defaults)
const DATA_PATH = path.join(process.cwd(), "data");
const DB_URL = process.env.DB_URL || "file:mastra.db";
const INDEX_NAME = process.env.INDEX_NAME || "berkshire_hathaway_letters";

// Quick checks
if (!process.env.OPENAI_API_KEY) {
  console.error(" OPENAI_API_KEY not found in .env. Add OPENAI_API_KEY=sk-... to .env and re-run.");
  process.exit(1);
}

// const { embeddings } = await embedMany({
//   values: chunks.map(c => c.text),
//   model: openaiProvider.embedding('text-embedding-3-small'), // <-- use provider
// });

const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

(async () => {
  const key = process.env.OPENAI_API_KEY;
  if (!key) { console.error('No OPENAI_API_KEY'); process.exit(1); }
  const resp = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: 'hello' })
  });
  console.log('Status:', resp.status);
  console.log('Body:', await resp.text());
})();

async function main() {
  try {
    // 1. Connect to LibSQL (file DB)
    const vectorStore = new LibSQLStore({ url: DB_URL });
    console.log("✅ Connected to LibSQL database at:", DB_URL);

    // 2. Read data folder
    const exists = await fs.stat(DATA_PATH).then(() => true).catch(() => false);
    if (!exists) {
      console.error(` Data folder not found at: ${DATA_PATH}`);
      console.error("Create a folder named 'data' in the project root and put your PDFs there.");
      process.exit(1);
    }

    const files = await fs.readdir(DATA_PATH);
    const pdfFiles = files.filter((f) => f.toLowerCase().endsWith(".pdf"));
    console.log(`🔎 Found ${pdfFiles.length} PDF file(s) to process.`);

    if (pdfFiles.length === 0) {
      console.warn("No PDFs found. Place Berkshire letters (PDFs) in the data/ folder and run again.");
      process.exit(0);
    }

    // 3. Process each PDF
    for (const file of pdfFiles) {
      try {
        console.log(`\n📄 Processing file: ${file}`);
        const filePath = path.join(DATA_PATH, file);
        const fileBuffer = await fs.readFile(filePath);

        const pdfData = await pdf(fileBuffer);
        const doc = MDocument.fromText(pdfData.text || "", { source: file });

        const chunks = await doc.chunk({
          strategy: "recursive",
          size: 1024,
          overlap: 100,
        });
        console.log(` -> Split into ${chunks.length} chunk(s).`);

        // 4. Create embeddings for all chunks (defensive handling of response)
        const values = chunks.map((c) => c.text);
        const embedResp = await embedMany({
          values,
          model: openai.embedding ? openai.embedding("text-embedding-3-small") : "text-embedding-3-small",
        });

        // embedMany may return { embeddings } or { data: [{ embedding }, ...] } depending on SDK version
        let embeddings = embedResp?.embeddings;
        if (!embeddings && embedResp?.data && Array.isArray(embedResp.data)) {
          embeddings = embedResp.data.map((d) => d.embedding || d.emb);
        }
        if (!embeddings) {
          throw new Error("Unexpected embedding response shape: " + JSON.stringify(Object.keys(embedResp || {})));
        }

        console.log(` -> Generated ${embeddings.length} embedding vector(s).`);

        // 5. Prepare metadata for upsert (include filename and chunk index)
        const metadatas = chunks.map((chunk, idx) => ({
          file,
          index: idx,
          textSnippet: chunk.text?.slice(0, 200) ?? "", // small preview
          ...chunk.metadata,
        }));

        // 6. Upsert into the vector store under INDEX_NAME
        await vectorStore.upsert(INDEX_NAME, embeddings, metadatas);
        console.log(` -> Stored ${embeddings.length} vectors in index '${INDEX_NAME}'.`);
      } catch (fileErr) {
        console.error(`Error processing file ${file}:`, fileErr);
      }
    }

    console.log("\n Ingestion complete! DB file (if any) is at:", DB_URL);
  } catch (error) {
    console.error("\n An error occurred during ingestion:", error);
    process.exit(1);
  }
}

main();
