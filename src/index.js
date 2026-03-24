import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { OpenAPIHono } from '@hono/zod-openapi'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import logger from './utils/logger.js'
import { setupRoutes } from './api/index.js'
import { logApiRequest } from './utils/logApiRequest.js'
import { rateLimiter } from './utils/rateLimit.js'
import { prettyPrint } from './utils/pretty.js'

// Inisialisasi app
const app = new OpenAPIHono()

// Middleware global
app.use('*', secureHeaders())
app.use('*', cors({
    exposeHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining']
}))
app.use('*', logApiRequest)
app.use('*', prettyPrint)
app.use('*', rateLimiter())

// Setup routes
setupRoutes(app)

// OpenAPI documentation
const openApiConfig = {
    openapi: '3.0.0',
    info: {
        version: '1.0.0',
        title: 'YeMo API',
        description: 'Simple and easy to use API. ⭐️ Star to support our work!',
    },
    servers: [
        { 
            url: process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000', 
            description: process.env.VERCEL_URL ? 'Production Server' : 'Development Server' 
        }
    ]
}

app.doc('/docs', openApiConfig)

// Serve static files - untuk Vercel, path disesuaikan
app.use('*', serveStatic({ 
    root: './page',
    // Tambahkan fallback untuk file yang tidak ditemukan
    rewriteRequestPath: (path) => {
        return path === '/' ? '/index.html' : path
    }
}))

// 404 handler
app.notFound(async (c) => {
    const acceptHeader = c.req.header('accept') || ''
    const isApiRequest = c.req.path.startsWith('/api/') || 
                         c.req.path === '/docs' || 
                         acceptHeader.includes('application/json')
    
    if (isApiRequest) {
        return c.json({
            success: false,
            status: 404,
            error: 'Not Found',
            message: `Route ${c.req.method} ${c.req.path} not found.`
        }, 404)
    }

    try {
        const html = await readFile(join(process.cwd(), 'page', 'status', '404.html'), 'utf8')
        return c.html(html, 404)
    } catch (e) {
        logger.warn('404.html not found, using default message')
        return c.text('404 Not Found', 404)
    }
})

// Error handler
app.onError(async (err, c) => {
    logger.error(`[Error] ${err.message}`)
    
    const acceptHeader = c.req.header('accept') || ''
    const isApiRequest = c.req.path.startsWith('/api/') || 
                         acceptHeader.includes('application/json')
    
    if (isApiRequest) {
        return c.json({
            success: false,
            status: 500,
            error: 'Internal Server Error',
            message: err.message || 'An unexpected error occurred.'
        }, 500)
    }

    return c.text('Internal Server Error', 500)
})

// Untuk Vercel: export app sebagai handler
export default app

// Untuk development local: tetap bisa dijalankan dengan node
if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
    const port = process.env.PORT || 3000
    
    serve({
        fetch: app.fetch,
        port
    }, (info) => {
        logger.ready(`Server is running on http://localhost:${info.port}`)
        logger.info(`Documentation available at http://localhost:${info.port}/docs`)
    })
}
