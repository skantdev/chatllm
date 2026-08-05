import { useEffect, useMemo, useState } from 'react'

const OLLAMA_ENDPOINT = import.meta.env.VITE_OLLAMA_ENDPOINT || 'http://localhost:11434/api/chat'
const DEFAULT_MODEL = import.meta.env.VITE_OLLAMA_MODEL || 'gemma4'
const CHAT_STORAGE_KEY = 'ollama-mini-chat-messages'
const MODEL_STORAGE_KEY = 'ollama-mini-chat-model'
const RAG_HISTORY_STORAGE_KEY = 'ollama-rag-qa-history'
const REQUEST_TIMEOUT_MS = 60000

const readStoredModel = () => {
  const savedModel = localStorage.getItem(MODEL_STORAGE_KEY)
  return typeof savedModel === 'string' && savedModel.trim().length > 0
    ? savedModel.trim()
    : DEFAULT_MODEL
}

const readStoredMessages = () => {
  try {
    const raw = localStorage.getItem(CHAT_STORAGE_KEY)
    if (!raw) return []

    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []

    return parsed.filter(
      (item) =>
        item &&
        (item.role === 'user' || item.role === 'assistant') &&
        typeof item.content === 'string',
    )
  } catch {
    return []
  }
}

const readStoredRagHistory = () => {
  try {
    const raw = localStorage.getItem(RAG_HISTORY_STORAGE_KEY)
    if (!raw) return []

    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function App() {
  const [activeTab, setActiveTab] = useState('general')

  const [messages, setMessages] = useState(readStoredMessages)
  const [model, setModel] = useState(readStoredModel)
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  const [ragQuestion, setRagQuestion] = useState('')
  const [ragHistory, setRagHistory] = useState(readStoredRagHistory)
  const [ragError, setRagError] = useState('')
  const [ragLoading, setRagLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [deletingDocumentId, setDeletingDocumentId] = useState('')
  const [isResettingStore, setIsResettingStore] = useState(false)
  const [stats, setStats] = useState({ documentCount: 0, chunkCount: 0, documents: [] })

  const refreshStats = async () => {
    const response = await fetch('/api/rag/stats')
    if (!response.ok) {
      throw new Error('Unable to load vector store stats.')
    }

    const data = await response.json()
    setStats({
      documentCount: data.documentCount || 0,
      chunkCount: data.chunkCount || 0,
      documents: Array.isArray(data.documents) ? data.documents : [],
    })
  }

  useEffect(() => {
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(messages))
  }, [messages])

  useEffect(() => {
    localStorage.setItem(RAG_HISTORY_STORAGE_KEY, JSON.stringify(ragHistory))
  }, [ragHistory])

  useEffect(() => {
    const trimmedModel = model.trim()
    if (trimmedModel.length > 0) {
      localStorage.setItem(MODEL_STORAGE_KEY, trimmedModel)
    }
  }, [model])

  useEffect(() => {
    const fetchStats = async () => {
      try {
        await refreshStats()
      } catch {
        // Keep UI usable if server is not up yet.
      }
    }

    fetchStats()
  }, [])

  const canSend = useMemo(
    () => input.trim().length > 0 && model.trim().length > 0 && !isLoading,
    [input, model, isLoading],
  )

  const canAskRag = useMemo(
    () => ragQuestion.trim().length > 0 && model.trim().length > 0 && !ragLoading && stats.chunkCount > 0,
    [ragQuestion, model, ragLoading, stats.chunkCount],
  )

  const sendMessage = async () => {
    const text = input.trim()
    const chosenModel = model.trim()
    if (!text || !chosenModel || isLoading) return

    const nextMessages = [...messages, { role: 'user', content: text }]
    setMessages(nextMessages)
    setInput('')
    setError('')
    setIsLoading(true)

    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

    try {
      const response = await fetch(OLLAMA_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: chosenModel,
          messages: nextMessages,
          stream: false,
        }),
        signal: controller.signal,
      })

      if (!response.ok) {
        throw new Error(`Request failed (${response.status})`)
      }

      const data = await response.json()
      const assistantText = data?.message?.content

      if (typeof assistantText !== 'string' || assistantText.trim() === '') {
        throw new Error('Ollama returned an empty response.')
      }

      setMessages((prev) => [...prev, { role: 'assistant', content: assistantText }])
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        setError('Request timed out. Please try again.')
      } else {
        setError(
          err instanceof Error
            ? err.message
            : 'Unable to reach Ollama. Ensure the local server is running.',
        )
      }
    } finally {
      window.clearTimeout(timeoutId)
      setIsLoading(false)
    }
  }

  const clearChat = () => {
    setMessages([])
    setError('')
    localStorage.removeItem(CHAT_STORAGE_KEY)
  }

  const clearRagHistory = () => {
    setRagHistory([])
    setRagError('')
    localStorage.removeItem(RAG_HISTORY_STORAGE_KEY)
  }

  const uploadDocuments = async (event) => {
    const files = Array.from(event.target.files || [])
    if (files.length === 0) return

    setRagError('')
    setUploading(true)

    const formData = new FormData()
    for (const file of files) {
      formData.append('files', file)
    }

    try {
      const response = await fetch('/api/rag/upload', {
        method: 'POST',
        body: formData,
      })

      const responseText = await response.text()
      const data = responseText ? JSON.parse(responseText) : null
      if (!response.ok) {
        throw new Error(data?.message || 'Upload failed.')
      }
      await refreshStats()

      const skippedCount = Array.isArray(data?.skipped) ? data.skipped.length : 0
      if (skippedCount > 0) {
        setRagError(`${skippedCount} file(s) were skipped. See server rules for supported formats.`)
      }
    } catch (err) {
      setRagError(err instanceof Error ? err.message : 'Upload failed.')
    } finally {
      event.target.value = ''
      setUploading(false)
    }
  }

  const askRagQuestion = async () => {
    const question = ragQuestion.trim()
    const chosenModel = model.trim()

    if (!question || !chosenModel || ragLoading) return

    setRagError('')
    setRagLoading(true)

    try {
      const response = await fetch('/api/rag/ask', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          question,
          model: chosenModel,
        }),
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data?.message || 'Failed to get RAG answer.')
      }

      setRagHistory((prev) => [
        ...prev,
        {
          question,
          answer: data?.answer || '',
          sources: Array.isArray(data?.sources) ? data.sources : [],
          createdAt: new Date().toISOString(),
        },
      ])
      setRagQuestion('')
    } catch (err) {
      setRagError(err instanceof Error ? err.message : 'Failed to get RAG answer.')
    } finally {
      setRagLoading(false)
    }
  }

  const deleteDocument = async (documentId, documentName) => {
    if (!documentId || deletingDocumentId) return

    const shouldDelete = window.confirm(`Delete ${documentName} from vector store?`)
    if (!shouldDelete) return

    setRagError('')
    setDeletingDocumentId(documentId)

    try {
      const response = await fetch(`/api/rag/document/${documentId}`, {
        method: 'DELETE',
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data?.message || 'Failed to delete document.')
      }

      await refreshStats()
      setRagHistory((prev) =>
        prev.filter(
          (item) => !Array.isArray(item.sources) || !item.sources.some((source) => source.documentName === documentName),
        ),
      )
    } catch (err) {
      setRagError(err instanceof Error ? err.message : 'Failed to delete document.')
    } finally {
      setDeletingDocumentId('')
    }
  }

  const resetVectorStore = async () => {
    if (isResettingStore) return

    const shouldReset = window.confirm('Reset the full vector store and remove all indexed documents?')
    if (!shouldReset) return

    setRagError('')
    setIsResettingStore(true)

    try {
      const response = await fetch('/api/rag/reset', {
        method: 'DELETE',
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data?.message || 'Failed to reset vector store.')
      }

      await refreshStats()
      setRagHistory([])
    } catch (err) {
      setRagError(err instanceof Error ? err.message : 'Failed to reset vector store.')
    } finally {
      setIsResettingStore(false)
    }
  }

  const onInputKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      sendMessage()
    }
  }

  const onRagQuestionKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      askRagQuestion()
    }
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_20%_20%,#fef3c7_0%,transparent_40%),radial-gradient(circle_at_80%_15%,#bae6fd_0%,transparent_35%),linear-gradient(180deg,#f8fafc_0%,#eef2ff_100%)] px-4 py-6 sm:px-8 sm:py-10">
      <section className="mx-auto flex w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-slate-200/80 bg-white/80 shadow-xl backdrop-blur">
        <header className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Ollama Local Chat</p>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
              General Chat + RAG Question Answer
            </h1>
          </div>
          <div className="inline-flex rounded-xl border border-slate-300 bg-white p-1 text-sm font-medium text-slate-700">
            <button
              type="button"
              onClick={() => setActiveTab('general')}
              className={`rounded-lg px-3 py-2 transition ${
                activeTab === 'general' ? 'bg-slate-900 text-white' : 'hover:bg-slate-100'
              }`}
            >
              General Chat
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('rag')}
              className={`rounded-lg px-3 py-2 transition ${
                activeTab === 'rag' ? 'bg-slate-900 text-white' : 'hover:bg-slate-100'
              }`}
            >
              RAG Q&A
            </button>
          </div>
        </header>

        {activeTab === 'general' && (
          <div className="flex h-[68vh] flex-col">
            <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5 sm:px-7">
              {messages.length === 0 && (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-600">
                  Ask anything. This tab sends your message to Ollama with model {model.trim() || DEFAULT_MODEL}.
                </div>
              )}

              {messages.map((message, index) => (
                <article
                  key={`${message.role}-${index}`}
                  className={`max-w-[90%] rounded-2xl px-4 py-3 text-sm leading-6 shadow-sm sm:text-base ${
                    message.role === 'user'
                      ? 'ml-auto bg-slate-900 text-slate-50'
                      : 'mr-auto border border-amber-200 bg-amber-50 text-slate-900'
                  }`}
                >
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] opacity-70">
                    {message.role}
                  </p>
                  <p className="whitespace-pre-wrap">{message.content}</p>
                </article>
              ))}

              {isLoading && (
                <div className="mr-auto inline-flex items-center gap-2 rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-600">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-slate-400"></span>
                  Thinking...
                </div>
              )}
            </div>

            {error && (
              <div className="mx-5 mb-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 sm:mx-7">
                {error}
              </div>
            )}

            <footer className="border-t border-slate-200 bg-white/70 px-5 py-4 sm:px-7">
              <div className="mb-3 flex flex-col gap-2 sm:max-w-xs">
                <label className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500" htmlFor="model-input">
                  Model
                </label>
                <input
                  id="model-input"
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                  placeholder={DEFAULT_MODEL}
                  className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-500"
                />
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <label className="sr-only" htmlFor="chat-input">
                  Message input
                </label>
                <textarea
                  id="chat-input"
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={onInputKeyDown}
                  placeholder="Type your message and press Enter..."
                  rows={3}
                  className="w-full resize-none rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none ring-0 transition placeholder:text-slate-400 focus:border-slate-500 sm:text-base"
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={clearChat}
                    className="rounded-2xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={isLoading || messages.length === 0}
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    onClick={sendMessage}
                    disabled={!canSend}
                    className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400 sm:text-base"
                  >
                    Send
                  </button>
                </div>
              </div>
            </footer>
          </div>
        )}

        {activeTab === 'rag' && (
          <div className="flex h-[68vh] flex-col">
            <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5 sm:px-7">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-2xl border border-slate-300 bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Vector Database</p>
                  <p className="mt-2 text-sm text-slate-700">Documents indexed: {stats.documentCount}</p>
                  <p className="text-sm text-slate-700">Chunks stored: {stats.chunkCount}</p>
                </div>
                <div className="rounded-2xl border border-slate-300 bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Upload Documents</p>
                  <p className="mt-2 text-sm text-slate-700">Supported: PDF, DOCX, DOC, TXT, MD, CSV, JSON</p>
                  <input
                    type="file"
                    multiple
                    accept=".pdf,.docx,.doc,.txt,.md,.csv,.json"
                    onChange={uploadDocuments}
                    disabled={uploading}
                    className="mt-3 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-900 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                  />
                  {uploading && <p className="mt-2 text-sm text-slate-600">Embedding and indexing files...</p>}
                  <button
                    type="button"
                    onClick={resetVectorStore}
                    disabled={isResettingStore || uploading || stats.documentCount === 0}
                    className="mt-3 rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isResettingStore ? 'Resetting...' : 'Reset Vector Store'}
                  </button>
                </div>
              </div>

              {stats.documents.length > 0 && (
                <div className="rounded-2xl border border-slate-300 bg-white p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Indexed Files</p>
                  <ul className="mt-2 space-y-2 text-sm text-slate-700">
                    {stats.documents.map((doc) => (
                      <li key={doc.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                        <span className="truncate pr-4">{doc.name}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-slate-500">{doc.chunkCount} chunks</span>
                          <button
                            type="button"
                            onClick={() => deleteDocument(doc.id, doc.name)}
                            disabled={deletingDocumentId === doc.id || isResettingStore}
                            className="rounded-md border border-rose-300 px-2 py-1 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {deletingDocumentId === doc.id ? 'Removing...' : 'Remove'}
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {ragHistory.length === 0 && (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-600">
                  Upload documents, then ask questions. Answers will be generated from the retrieved document chunks.
                </div>
              )}

              {ragHistory.map((item, index) => (
                <div key={`${item.createdAt}-${index}`} className="space-y-3 rounded-2xl border border-slate-300 bg-white p-4">
                  <div className="rounded-xl bg-slate-900 px-4 py-3 text-sm text-white">
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] opacity-80">Question</p>
                    <p className="whitespace-pre-wrap">{item.question}</p>
                  </div>
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-slate-900">
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] opacity-80">Answer</p>
                    <p className="whitespace-pre-wrap">{item.answer}</p>
                  </div>
                  {item.sources?.length > 0 && (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                      <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Sources</p>
                      <ul className="space-y-2">
                        {item.sources.map((source, sourceIndex) => (
                          <li key={`${source.documentName}-${sourceIndex}`} className="rounded-lg bg-white px-3 py-2">
                            <p className="font-medium text-slate-900">{source.documentName}</p>
                            <p className="text-xs text-slate-500">Similarity: {source.score}</p>
                            <p className="mt-1 text-xs text-slate-600">{source.snippet}...</p>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {ragError && (
              <div className="mx-5 mb-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 sm:mx-7">
                {ragError}
              </div>
            )}

            <footer className="border-t border-slate-200 bg-white/70 px-5 py-4 sm:px-7">
              <div className="mb-3 flex flex-col gap-2 sm:max-w-xs">
                <label className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500" htmlFor="rag-model-input">
                  Model
                </label>
                <input
                  id="rag-model-input"
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                  placeholder={DEFAULT_MODEL}
                  className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-500"
                />
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <label className="sr-only" htmlFor="rag-question-input">
                  RAG question
                </label>
                <textarea
                  id="rag-question-input"
                  value={ragQuestion}
                  onChange={(event) => setRagQuestion(event.target.value)}
                  onKeyDown={onRagQuestionKeyDown}
                  placeholder="Ask a question from uploaded documents..."
                  rows={3}
                  className="w-full resize-none rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none ring-0 transition placeholder:text-slate-400 focus:border-slate-500 sm:text-base"
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={clearRagHistory}
                    className="rounded-2xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={ragLoading || ragHistory.length === 0}
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    onClick={askRagQuestion}
                    disabled={!canAskRag}
                    className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400 sm:text-base"
                  >
                    {ragLoading ? 'Searching...' : 'Ask'}
                  </button>
                </div>
              </div>
            </footer>
          </div>
        )}
      </section>
    </main>
  )
}

export default App
