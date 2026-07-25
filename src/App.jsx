import { useEffect, useMemo, useState } from 'react'

const OLLAMA_ENDPOINT = 'http://localhost:11434/api/chat'
const DEFAULT_MODEL = 'gemma4'
const STORAGE_KEY = 'ollama-mini-chat-messages'
const REQUEST_TIMEOUT_MS = 60000

function App() {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return

      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) return

      const validMessages = parsed.filter(
        (item) =>
          item &&
          (item.role === 'user' || item.role === 'assistant') &&
          typeof item.content === 'string',
      )
      setMessages(validMessages)
    } catch {
      setError('Saved chat could not be loaded. Starting fresh.')
    }
  }, [])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages))
  }, [messages])

  const canSend = useMemo(() => input.trim().length > 0 && !isLoading, [input, isLoading])

  const sendMessage = async () => {
    const text = input.trim()
    if (!text || isLoading) return

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
          model: DEFAULT_MODEL,
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
    localStorage.removeItem(STORAGE_KEY)
  }

  const onInputKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      sendMessage()
    }
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_20%_20%,#fef3c7_0%,transparent_40%),radial-gradient(circle_at_80%_15%,#bae6fd_0%,transparent_35%),linear-gradient(180deg,#f8fafc_0%,#eef2ff_100%)] px-4 py-6 sm:px-8 sm:py-10">
      <section className="mx-auto flex w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-slate-200/80 bg-white/80 shadow-xl backdrop-blur">
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4 sm:px-7">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Ollama Local Chat</p>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
              Minimal GPT-style Chat
            </h1>
          </div>
          <button
            type="button"
            onClick={clearChat}
            className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={isLoading || messages.length === 0}
          >
            Clear
          </button>
        </header>

        <div className="flex h-[65vh] flex-col">
          <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5 sm:px-7">
            {messages.length === 0 && (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-600">
                Ask anything. This app sends your message to local Ollama with model {DEFAULT_MODEL}.
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
              <button
                type="button"
                onClick={sendMessage}
                disabled={!canSend}
                className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400 sm:text-base"
              >
                Send
              </button>
            </div>
          </footer>
        </div>
      </section>
    </main>
  )
}

export default App
