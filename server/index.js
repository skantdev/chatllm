import cors from 'cors'
import express from 'express'
import multer from 'multer'
import path from 'node:path'
import process from 'node:process'
import { extractTextFromFile, isSupportedFile } from './documentParser.js'
import { chatWithContext, embedTexts } from './ollamaClient.js'
import {
  addDocumentChunks,
  chunkText,
  clearStore,
  deleteDocumentById,
  getStoreStats,
  searchSimilarChunks,
} from './vectorStore.js'

const SERVER_PORT = Number(process.env.SERVER_PORT || 8787)
const DEFAULT_CHAT_MODEL = process.env.VITE_OLLAMA_MODEL || 'gemma4'

const app = express()
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024,
    files: 10,
  },
})

app.use(cors())
app.use(express.json({ limit: '2mb' }))

app.get('/api/health', (_, res) => {
  res.json({ ok: true })
})

app.get('/api/rag/stats', async (_, res) => {
  try {
    const stats = await getStoreStats()
    res.json(stats)
  } catch (error) {
    res.status(500).json({ message: error instanceof Error ? error.message : 'Unable to read vector store.' })
  }
})

app.delete('/api/rag/document/:documentId', async (req, res) => {
  try {
    const { documentId } = req.params
    const deleted = await deleteDocumentById(documentId)

    if (!deleted.found) {
      return res.status(404).json({ message: 'Document not found.' })
    }

    const stats = await getStoreStats()
    return res.json({ message: `Deleted ${deleted.name}.`, stats })
  } catch (error) {
    return res.status(500).json({
      message: error instanceof Error ? error.message : 'Failed to delete document.',
    })
  }
})

app.delete('/api/rag/reset', async (_, res) => {
  try {
    await clearStore()
    const stats = await getStoreStats()
    return res.json({ message: 'Vector store reset.', stats })
  } catch (error) {
    return res.status(500).json({
      message: error instanceof Error ? error.message : 'Failed to reset vector store.',
    })
  }
})

app.post('/api/rag/upload', upload.array('files', 10), async (req, res) => {
  try {
    const files = req.files || []

    if (!Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ message: 'Please upload at least one file.' })
    }

    const uploaded = []
    const skipped = []

    for (const file of files) {
      if (!isSupportedFile(file.originalname)) {
        skipped.push({ file: file.originalname, reason: 'Unsupported file format.' })
        continue
      }

      const text = await extractTextFromFile(file)
      const chunks = chunkText(text)

      if (chunks.length === 0) {
        skipped.push({ file: file.originalname, reason: 'Document has no extractable text.' })
        continue
      }

      const embeddings = await embedTexts(chunks)
      const chunksWithEmbeddings = chunks.map((content, index) => ({
        content,
        embedding: embeddings[index],
      }))

      const ext = path.extname(file.originalname).replace('.', '').toLowerCase() || 'unknown'
      const result = await addDocumentChunks({
        documentName: file.originalname,
        fileType: ext,
        chunksWithEmbeddings,
      })

      uploaded.push({
        file: file.originalname,
        chunkCount: result.chunkCount,
      })
    }

    const stats = await getStoreStats()

    return res.status(201).json({
      message: 'Documents processed.',
      uploaded,
      skipped,
      stats,
    })
  } catch (error) {
    return res.status(500).json({
      message: error instanceof Error ? error.message : 'Failed to process files.',
    })
  }
})

app.post('/api/rag/ask', async (req, res) => {
  try {
    const question = typeof req.body?.question === 'string' ? req.body.question.trim() : ''
    const model = typeof req.body?.model === 'string' ? req.body.model.trim() : DEFAULT_CHAT_MODEL

    if (!question) {
      return res.status(400).json({ message: 'Question is required.' })
    }

    const stats = await getStoreStats()
    if (stats.chunkCount === 0) {
      return res.status(400).json({ message: 'No indexed documents found. Upload files first.' })
    }

    const [questionEmbedding] = await embedTexts([question])
    const topChunks = await searchSimilarChunks({ questionEmbedding, topK: 5 })

    if (topChunks.length === 0) {
      return res.status(400).json({ message: 'No relevant context found in indexed documents.' })
    }

    const context = topChunks
      .map((chunk, index) => `Source ${index + 1} - ${chunk.documentName}:\n${chunk.content}`)
      .join('\n\n')

    const answer = await chatWithContext({ model, question, context })

    const sources = topChunks.map((chunk) => ({
      documentName: chunk.documentName,
      score: Number(chunk.score.toFixed(4)),
      snippet: chunk.content.slice(0, 300),
    }))

    return res.json({
      answer,
      sources,
    })
  } catch (error) {
    return res.status(500).json({
      message: error instanceof Error ? error.message : 'Failed to answer question.',
    })
  }
})

app.listen(SERVER_PORT, () => {
  console.log(`RAG server running on http://localhost:${SERVER_PORT}`)
})
