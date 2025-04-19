import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { serveStatic } from '@hono/node-server/serve-static'
import pkg from 'pg'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import movieData from '../dataset/movie_summary.json' assert { type: 'json' }
import fetch from 'node-fetch'
import * as dotenv from 'dotenv'

// Load environment variables from .env file
dotenv.config()

const { Pool } = pkg
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Validate required environment variables
const requiredEnvVars = [
    'CLOUDFLARE_API_TOKEN',
    'CLOUDFLARE_ACCOUNT_ID',
    'POSTGRES_HOST',
    'POSTGRES_DB',
    'POSTGRES_USER',
    'POSTGRES_PASSWORD'
]

for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
        console.error(`Missing required environment variable: ${envVar}`)
        process.exit(1)
    }
}

// Get environment variables
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN!
const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID!

const app = new Hono()

// Database connection
const pool = new Pool({
    host: process.env.POSTGRES_HOST,
    port: parseInt(process.env.POSTGRES_PORT || '5432'),
    database: process.env.POSTGRES_DB,
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
})

// Function to run migrations
async function runMigrations() {
    try {
        const migrationSQL = fs.readFileSync(
            path.join(__dirname, '../db/migrations.sql'),
            'utf8'
        )
        await pool.query(migrationSQL)
        console.log('Migrations completed successfully')
    } catch (error) {
        console.error('Error running migrations:', error)
        throw error
    }
}

// -------- Webapp --------

// Serve static files
app.get('/', serveStatic({ path: './index.html' }))

// Search API
app.get('/search', async (c) => {
    try {
        const query = c.req.query('query')
        const useOllama = c.req.query('use-ollama') === 'on'
        
        if (!query) {
            return c.json({ error: 'Query parameter is required' }, 400)
        }

        let queryEmbedding;
        let embeddingField;
        
        if (useOllama) {
            // Use Ollama for nomic embeddings
            const response = await fetch('http://localhost:11434/api/embeddings', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: 'nomic-embed-text',
                    prompt: query
                })
            })

            const data = await response.json()
            
            if (!data.embedding) {
                console.error('Failed to generate embedding for search query:', data)
                return c.json({ error: 'Failed to process search query with Ollama' }, 500)
            }

            // Format the embedding array as a pgvector string
            queryEmbedding = `[${data.embedding.join(',')}]`
            embeddingField = 'nomic_embedding'
        } else {
            // Use Cloudflare for embeddings (existing code)
            const response = await fetch(
                `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/run/@cf/baai/bge-large-en-v1.5`,
                {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ text: query })
                }
            )

            const data = await response.json()
            
            if (!data.success || !data.result?.data?.[0]) {
                console.error('Failed to generate embedding for search query:', data)
                return c.json({ error: 'Failed to process search query' }, 500)
            }

            // Format the embedding array as a pgvector string
            queryEmbedding = `[${data.result.data[0].join(',')}]`
            embeddingField = 'embedding'
        }

        // Search for the top 2 most similar documents using cosine distance
        const searchQuery = `
            SELECT 
                title,
                content,
                1 - (${embeddingField} <=> $1::vector) as similarity_score
            FROM documents
            WHERE ${embeddingField} IS NOT NULL
            ORDER BY ${embeddingField} <=> $1::vector
            LIMIT 2
        `
        const results = await pool.query(searchQuery, [queryEmbedding])

        if (results.rows.length < 2) {
            return c.json({ error: 'Not enough documents found for RAG' }, 400)
        }

        // Extract the top 2 documents
        const doc1 = results.rows[0].content
        const doc2 = results.rows[1].content

        // Create the prompt
        const prompt = `
I am providing you as context these documents below,
The documents have a structure like this

start doc 1:
..
end doc

Note:
Make sure you answer the questions only from the documents below, dont answer from your training data, be grounded in these documents only.
If you do not know the answer say "The answer is not present in any of the documents"

Here are all the documents - 
start doc 1:
${doc1}
end doc

start doc 2:
${doc2}
end doc


Now answer the question based on these documents
based on these documents
answer this question : "${query}"
`

        console.log('Prompt sent to LLM:', prompt) // Log the prompt

        let answerData;
        
        if (useOllama) {
            // Use Ollama's gemma3 for generation
            const answerResponse = await fetch('http://localhost:11434/api/generate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: 'gemma3',
                    prompt: prompt
                })
            })
            
            answerData = await answerResponse.json()
            
            if (!answerData.response) {
                console.error('Failed to generate answer with Ollama:', answerData)
                return c.json({ error: 'Failed to generate answer with Ollama' }, 500)
            }
            
            // Use the response field from Ollama
            let answer = answerData.response.trim()
            
            // Validate the AI response
            if (!answer || answer.includes('No document provided') || answer.includes('There are no documents')) {
                return c.json({ error: 'AI response was invalid or incomplete' }, 500)
            }
            
            // Replace \n with <br/>
            answer = answer.replace(/\n/g, '<br/>')
            
            // Return the answer
            return c.json({ answer })
        } else {
            // Use Cloudflare for generation (existing code)
            const answerResponse = await fetch(
                `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/run/@cf/meta/llama-4-scout-17b-16e-instruct`,
                {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ prompt })
                }
            )

            answerData = await answerResponse.json()

            console.log('Output from LLM:', answerData) // Log the output

            if (!answerData.success || !answerData.result?.response) {
                console.error('Failed to generate answer:', answerData)
                return c.json({ error: 'Failed to generate answer' }, 500)
            }

            // Validate the AI response
            let answer = answerData.result.response.trim()
            if (!answer || answer.includes('No document provided') || answer.includes('There are no documents')) {
                return c.json({ error: 'AI response was invalid or incomplete' }, 500)
            }

            // Replace \n with <br/>
            answer = answer.replace(/\n/g, '<br/>')

            // Return the answer
            return c.json({ answer })
        }
    } catch (error) {
        console.error('Search error:', error)
        return c.json({ error: 'Search failed' }, 500)
    }
})

// Update the generate_embeddings endpoint
app.post('/generate_embeddings', async (c) => {
    try {
        const datasetDir = path.join(__dirname, '../dataset')
        const files = fs.readdirSync(datasetDir)
        let processedCount = 0

        for (const file of files) {
            const filePath = path.join(datasetDir, file)
            const content = fs.readFileSync(filePath, 'utf8')

            console.log(`Processing file: ${file}...`)

            // Get embedding from Cloudflare AI API
            const response = await fetch(
                `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/run/@cf/baai/bge-large-en-v1.5`,
                {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ text: content })
                }
            )

            const data = await response.json()

            if (!data.success) {
                console.error(`Failed to generate embedding for file ${file}:`, data.errors)
                continue
            }

            if (!data.result?.data?.[0]) {
                console.error(`Invalid embedding format for file ${file}:`, data)
                continue
            }

            // Format the embedding array as a pgvector string
            const embeddingString = `[${data.result.data[0].join(',')}]`
            
            // Get Nomic embedding from Ollama
            const nomicResponse = await fetch('http://localhost:11434/api/embeddings', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: "nomic-embed-text",
                    prompt: content
                })
            })
            
            const nomicData = await nomicResponse.json()
            
            if (!nomicData.embedding) {
                console.error(`Failed to generate Nomic embedding for file ${file}:`, nomicData)
                continue
            }
            
            // Format the Nomic embedding array as a pgvector string
            const nomicEmbeddingString = `[${nomicData.embedding.join(',')}]`

            // Insert into database
            const query = `
                INSERT INTO documents (title, content, embedding, nomic_embedding)
                VALUES ($1, $2, $3::vector, $4::vector)
                RETURNING id
            `
            const result = await pool.query(query, [
                file,
                content,
                embeddingString,
                nomicEmbeddingString
            ])

            processedCount++
            console.log(`✅ Successfully processed "${file}" (ID: ${result.rows[0].id})`)
        }

        console.log(`\n🎉 Completed! Generated embeddings for ${processedCount} files`)
        return c.json({
            message: `Generated embeddings for ${processedCount} files`
        })
    } catch (error) {
        console.error('Error generating embeddings:', error)
        return c.json({ error: 'Failed to generate embeddings' }, 500)
    }
})

// Initialize database and start server
async function initialize() {
    try {
        await runMigrations()
        serve(app, (info) => {
            console.log(`Server running at http://localhost:${info.port}`)
        })
    } catch (error) {
        console.error('Failed to initialize:', error)
        process.exit(1)
    }
}

console.log("Starting server...")
initialize()