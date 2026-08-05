import process from 'node:process'

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434'
const EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text'

const hashToken = (token) => {
  let hash = 2166136261
  for (let i = 0; i < token.length; i += 1) {
    hash ^= token.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }

  return hash >>> 0
}

const createLocalEmbedding = (text, dimensions = 384) => {
  const vector = new Array(dimensions).fill(0)
  const tokens = text.toLowerCase().match(/[a-z0-9]+/g) || []

  for (const token of tokens) {
    const index = hashToken(token) % dimensions
    vector[index] += 1
  }

  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
  if (magnitude === 0) {
    return vector
  }

  return vector.map((value) => value / magnitude)
}

const parseJson = async (response) => {
  const payload = await response.text()
  try {
    return JSON.parse(payload)
  } catch {
    throw new Error(`Invalid JSON from Ollama: ${payload.slice(0, 160)}`)
  }
}

export const embedTexts = async (texts) => {
  if (!Array.isArray(texts) || texts.length === 0) {
    throw new Error('No text provided for embedding.')
  }

  try {
    const embedResponse = await fetch(`${OLLAMA_BASE_URL}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: EMBED_MODEL, input: texts }),
    })

    if (embedResponse.ok) {
      const data = await parseJson(embedResponse)

      if (Array.isArray(data?.embeddings) && data.embeddings.length === texts.length) {
        return data.embeddings
      }

      if (Array.isArray(data?.embedding) && texts.length === 1) {
        return [data.embedding]
      }
    }

    const fallbackEmbeddings = []

    for (const text of texts) {
      const response = await fetch(`${OLLAMA_BASE_URL}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: EMBED_MODEL, prompt: text }),
      })

      if (!response.ok) {
        throw new Error('Ollama embedding endpoint unavailable.')
      }

      const data = await parseJson(response)
      if (!Array.isArray(data?.embedding)) {
        throw new Error('Embedding response is missing vector data.')
      }

      fallbackEmbeddings.push(data.embedding)
    }

    return fallbackEmbeddings
  } catch {
    return texts.map((text) => createLocalEmbedding(text))
  }
}

export const chatWithContext = async ({ model, question, context }) => {
  const chatResponse = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      messages: [
        {
          role: 'system',
          content:
            'You are a document question-answer assistant. Answer only from the provided context. If the answer is not in context, say you do not know based on the uploaded documents.',
        },
        {
          role: 'user',
          content: `Question:\n${question}\n\nContext:\n${context}`,
        },
      ],
    }),
  })

  if (!chatResponse.ok) {
    throw new Error(`Chat request failed (${chatResponse.status}).`)
  }

  const data = await parseJson(chatResponse)
  const content = data?.message?.content

  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new Error('Ollama chat response is empty.')
  }

  return content
}
