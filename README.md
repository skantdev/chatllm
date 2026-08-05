# Ollama Chat + RAG App

This project now has two tabs in one web app:
- General Chat: normal chatbot using Ollama chat endpoint.
- RAG Q&A: upload documents, generate embeddings, store vectors, and answer questions from retrieved chunks.

## Features

- React + Tailwind frontend with tabbed interface
- General chatbot with model selection
- RAG pipeline:
	- upload files
	- extract text
	- chunk text
	- embed chunks using Ollama embedding model
	- store vectors in local JSON vector database
	- retrieve relevant chunks and answer with Ollama
- Local persistence for chat and RAG history

## Supported File Types

- .pdf
- .docx
- .doc
- .txt
- .md
- .csv
- .json

## Requirements

- Node.js 20+
- Ollama running locally at http://localhost:11434
- Pulled chat model, for example: gemma4
- Pulled embedding model, for example: nomic-embed-text

Pull model examples:

ollama pull gemma4
ollama pull nomic-embed-text

## Quick Start

1. Install dependencies

npm install

2. Copy environment template

copy .env.example .env

3. Start frontend + backend together

npm run dev

4. Open the Vite URL shown in terminal

## Environment Variables

- VITE_OLLAMA_ENDPOINT
	- default: http://localhost:11434/api/chat
- VITE_OLLAMA_MODEL
	- default: gemma4
- OLLAMA_BASE_URL
	- default: http://localhost:11434
- OLLAMA_EMBED_MODEL
	- default: nomic-embed-text
- SERVER_PORT
	- default: 8787

## Backend API

- GET /api/health
- GET /api/rag/stats
- POST /api/rag/upload (multipart form-data with field name files)
- POST /api/rag/ask ({ question, model })
- DELETE /api/rag/document/:documentId
- DELETE /api/rag/reset

## Build

npm run build

## Notes

- Vector database is stored at server/data/vector-store.json
- For production use, move vector storage to a dedicated database service.
