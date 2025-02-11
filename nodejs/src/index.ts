import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { serveStatic } from '@hono/node-server/serve-static'
import pkg from 'pg'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const { Pool } = pkg
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

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

// Serve static files
app.get('/', serveStatic({ path: './index.html' }))

// Search API
app.get('/search', (c) => {
    
    const results = [
        {
            doc: {
                title: "Test Document 1",
                content: "This is the content of Test Document 1"
            },
            similarity_score: 0.92
        },
        {
            doc: {
                title: "Test Document 2",
                content: "This is the content of Test Document 2"
            },
            similarity_score: 0.85
        }
    ]
    return c.json(results)
})

// Insert data API
app.get('/insert', async (c) => {
    try {
        const title = "hello"
        const content = "hello"
        const embedding = null  // Initially set embedding to null since it's optional
        
        if (!title || !content) {
            return c.json({ error: 'Title and content are required' }, 400)
        }

        const query = `
            INSERT INTO documents (title, content, embedding)
            VALUES ($1, $2, $3)
            RETURNING id, title, content
        `
        const result = await pool.query(query, [title, content, embedding])
        
        return c.json({
            message: 'Document inserted successfully',
            document: result.rows[0]
        })
    } catch (error) {
        console.error('Error inserting document:', error)
        return c.json({ error: 'Failed to insert document' }, 500)
    }
})

console.log("Starting server...")

// Generate embeddings API
app.post('/generate_embeddings', (c) => {
    return c.json({
        message: "Generated embeddings for 5 documents"
    })
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

initialize() 