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
        
        if (!query) {
            return c.json({ error: 'Query parameter is required' }, 400)
        }

        // Get embedding from Cloudflare AI API
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
        const queryEmbedding = `[${data.result.data[0].join(',')}]`

        // Search for similar documents using cosine distance
        const searchQuery = `
            SELECT 
                title,
                content,
                1 - (embedding <=> $1::vector) as similarity_score
            FROM documents
            WHERE embedding IS NOT NULL
            ORDER BY embedding <=> $1::vector
            LIMIT 10
        `
        const results = await pool.query(searchQuery, [queryEmbedding])

        // Format results to match expected frontend format
        const formattedResults = results.rows.map(row => ({
            doc: {
                title: row.title,
                content: row.content
            },
            similarity_score: row.similarity_score
        }))

        return c.json(formattedResults)
    } catch (error) {
        console.error('Search error:', error)
        return c.json({ error: 'Search failed' }, 500)
    }
})

// Update the generate_embeddings endpoint
app.post('/generate_embeddings', async (c) => {
    try {
        let processedCount = 0
        
        for (const movie of movieData) {
            console.log(`Processing movie: ${movie.movie_name}...`)
            
            // Get embedding from Cloudflare AI API
            const response = await fetch(
                `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/run/@cf/baai/bge-large-en-v1.5`,
                {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ text: movie.overview })
                }
            )

            const data = await response.json()
            
            if (!data.success) {
                console.error(`Failed to generate embedding for movie ${movie.movie_name}:`, data.errors)
                continue
            }

            // Check if we have the embedding data in the correct format
            if (!data.result?.data?.[0]) {
                console.error(`Invalid embedding format for movie ${movie.movie_name}:`, data)
                continue
            }

            // Format the embedding array as a pgvector string
            // pgvector expects format like '[1,2,3]' for vectors
            const embeddingString = `[${data.result.data[0].join(',')}]`

            // Insert into database
            const query = `
                INSERT INTO documents (title, content, embedding)
                VALUES ($1, $2, $3::vector)
                RETURNING id
            `
            const result = await pool.query(query, [
                movie.movie_name,
                movie.overview,
                embeddingString
            ])

            processedCount++
            console.log(`✅ Successfully processed "${movie.movie_name}" (ID: ${result.rows[0].id})`)
        }

        console.log(`\n🎉 Completed! Generated embeddings for ${processedCount} movies`)
        return c.json({
            message: `Generated embeddings for ${processedCount} documents`
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