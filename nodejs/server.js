import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { serveStatic } from '@hono/node-server/serve-static'

const app = new Hono()

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

// Generate embeddings API
app.post('/generate_embeddings', (c) => {
    return c.json({
        message: "Generated embeddings for 5 documents"
    })
})

serve(app, (info) => {
    console.log(`Server running at http://localhost:${info.port}`)
}) 