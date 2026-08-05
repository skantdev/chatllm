import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PDFParse } from 'pdf-parse'
import mammoth from 'mammoth'
import WordExtractor from 'word-extractor'

const SUPPORTED_EXTENSIONS = new Set(['.pdf', '.docx', '.doc', '.txt', '.md', '.csv', '.json'])

export const isSupportedFile = (name) => {
  const ext = path.extname(name).toLowerCase()
  return SUPPORTED_EXTENSIONS.has(ext)
}

const parseDocFile = async (buffer, originalName) => {
  const extractor = new WordExtractor()
  const tempPath = path.join(os.tmpdir(), `upload-${Date.now()}-${originalName}`)

  try {
    await fs.writeFile(tempPath, buffer)
    const extracted = await extractor.extract(tempPath)
    return extracted?.getBody?.() || ''
  } finally {
    await fs.rm(tempPath, { force: true })
  }
}

export const extractTextFromFile = async (file) => {
  const extension = path.extname(file.originalname).toLowerCase()

  if (!isSupportedFile(file.originalname)) {
    throw new Error(`Unsupported file format: ${extension}`)
  }

  if (extension === '.pdf') {
    const parser = new PDFParse({ data: file.buffer })

    try {
      const parsed = await parser.getText()
      return parsed.text || ''
    } finally {
      await parser.destroy()
    }
  }

  if (extension === '.docx') {
    const parsed = await mammoth.extractRawText({ buffer: file.buffer })
    return parsed.value || ''
  }

  if (extension === '.doc') {
    return parseDocFile(file.buffer, file.originalname)
  }

  return file.buffer.toString('utf8')
}
