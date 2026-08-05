import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const VECTOR_DB_PATH = path.join(process.cwd(), 'server', 'data', 'vector-store.json')

const defaultStore = () => ({
  documents: [],
  chunks: [],
})

const ensureStoreDir = async () => {
  const dir = path.dirname(VECTOR_DB_PATH)
  await fs.mkdir(dir, { recursive: true })
}

export const readStore = async () => {
  await ensureStoreDir()
  try {
    const raw = await fs.readFile(VECTOR_DB_PATH, 'utf8')
    const parsed = JSON.parse(raw)

    if (!Array.isArray(parsed?.documents) || !Array.isArray(parsed?.chunks)) {
      return defaultStore()
    }

    return parsed
  } catch {
    return defaultStore()
  }
}

export const writeStore = async (store) => {
  await ensureStoreDir()
  await fs.writeFile(VECTOR_DB_PATH, JSON.stringify(store, null, 2), 'utf8')
}

export const chunkText = (text, chunkSize = 900, overlap = 150) => {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) return []

  const chunks = []
  let start = 0

  while (start < normalized.length) {
    const end = Math.min(start + chunkSize, normalized.length)
    const chunk = normalized.slice(start, end).trim()
    if (chunk.length > 0) {
      chunks.push(chunk)
    }

    if (end >= normalized.length) {
      break
    }

    start = Math.max(0, end - overlap)
  }

  return chunks
}

const cosineSimilarity = (a, b) => {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || a.length !== b.length) {
    return -1
  }

  let dot = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }

  if (normA === 0 || normB === 0) {
    return -1
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

export const addDocumentChunks = async ({ documentName, fileType, chunksWithEmbeddings }) => {
  const store = await readStore()

  const documentId = randomUUID()
  const uploadedAt = new Date().toISOString()

  store.documents.push({
    id: documentId,
    name: documentName,
    type: fileType,
    uploadedAt,
    chunkCount: chunksWithEmbeddings.length,
  })

  for (let index = 0; index < chunksWithEmbeddings.length; index += 1) {
    const { content, embedding } = chunksWithEmbeddings[index]
    store.chunks.push({
      id: randomUUID(),
      documentId,
      documentName,
      index,
      content,
      embedding,
      uploadedAt,
    })
  }

  await writeStore(store)

  return {
    documentId,
    chunkCount: chunksWithEmbeddings.length,
  }
}

export const searchSimilarChunks = async ({ questionEmbedding, topK = 5 }) => {
  const store = await readStore()

  const scored = store.chunks
    .map((chunk) => ({
      ...chunk,
      score: cosineSimilarity(questionEmbedding, chunk.embedding),
    }))
    .filter((chunk) => Number.isFinite(chunk.score) && chunk.score > -1)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)

  return scored
}

export const getStoreStats = async () => {
  const store = await readStore()

  return {
    documentCount: store.documents.length,
    chunkCount: store.chunks.length,
    documents: store.documents,
  }
}

export const deleteDocumentById = async (documentId) => {
  const store = await readStore()

  const existing = store.documents.find((doc) => doc.id === documentId)
  if (!existing) {
    return { found: false }
  }

  store.documents = store.documents.filter((doc) => doc.id !== documentId)
  store.chunks = store.chunks.filter((chunk) => chunk.documentId !== documentId)
  await writeStore(store)

  return { found: true, name: existing.name }
}

export const clearStore = async () => {
  await writeStore(defaultStore())
}
