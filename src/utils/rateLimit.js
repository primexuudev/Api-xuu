import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

// In-memory storage untuk rate limiting (single instance)
const clients = new Map()

const config = {
    windowMs: 10 * 60 * 1000, // 10 minutes
    max: 100, // max 100 requests per window
    whitelist: ['127.0.0.1', '::1', '::ffff:127.0.0.1'],
    banList: [] // bisa diisi dengan IP yang ingin diblokir
}

// Cleanup expired clients periodically
setInterval(() => {
    const now = Date.now()
    for (const [ip, data] of clients.entries()) {
        if (now > data.resetTime) {
            clients.delete(ip)
        }
    }
}, 10 * 60 * 1000) // Cleanup every 10 minutes

export const rateLimiter = () => {
    return async (c, next) => {
        // Extract client IP dengan berbagai kemungkinan header
        let ip = c.req.header('x-forwarded-for')?.split(',')[0] ||
            c.req.header('x-real-ip') ||
            c.env?.incoming?.socket?.remoteAddress ||
            c.req.header('cf-connecting-ip') || // Cloudflare
            '127.0.0.1'

        // Normalize localhost IPs
        if (ip === '::1') ip = '127.0.0.1'
        if (ip.startsWith('::ffff:')) ip = ip.replace('::ffff:', '')

        // Check ban list
        if (config.banList.includes(ip)) {
            const isApiRequest = c.req.path.startsWith('/api/') || 
                                c.req.header('accept')?.includes('application/json')
            
            if (isApiRequest) {
                return c.json({
                    success: false,
                    status: 403,
                    error: 'Forbidden',
                    message: 'Your IP has been banned from accessing this API.'
                }, 403)
            }

            try {
                const html = await readFile(join(process.cwd(), 'page', 'status', '403.html'), 'utf8')
                return c.html(html, 403)
            } catch (e) {
                return c.text('403 Forbidden', 403)
            }
        }

        // Whitelist IPs (unlimited access)
        if (config.whitelist.includes(ip)) {
            c.header('X-RateLimit-Limit', 'UNLIMITED')
            c.header('X-RateLimit-Remaining', 'UNLIMITED')
            await next()
            return
        }

        // Skip rate limiting for non-API routes (optional)
        if (!c.req.path.startsWith('/api/')) {
            await next()
            return
        }

        const now = Date.now()
        let clientData = clients.get(ip)

        // Initialize or reset client data
        if (!clientData) {
            clientData = {
                count: c.req.method === 'HEAD' ? 0 : 1,
                resetTime: now + config.windowMs
            }
            clients.set(ip, clientData)
        } 
        // Check if window has expired
        else if (now > clientData.resetTime) {
            clientData = {
                count: c.req.method === 'HEAD' ? 0 : 1,
                resetTime: now + config.windowMs
            }
            clients.set(ip, clientData)
        } 
        // Increment count (skip for HEAD requests)
        else if (c.req.method !== 'HEAD') {
            clientData.count++
        }

        // Check if rate limit exceeded
        if (clientData.count > config.max) {
            const retryAfter = Math.ceil((clientData.resetTime - now) / 1000)
            
            // Set rate limit headers
            c.header('X-RateLimit-Limit', config.max.toString())
            c.header('X-RateLimit-Remaining', '0')
            c.header('Retry-After', retryAfter.toString())

            // Format time for user-friendly message
            const formatTime = (seconds) => {
                const hours = Math.floor(seconds / 3600)
                const minutes = Math.floor((seconds % 3600) / 60)
                const secs = seconds % 60
                const parts = []
                if (hours > 0) parts.push(`${hours} hour${hours > 1 ? 's' : ''}`)
                if (minutes > 0) parts.push(`${minutes} minute${minutes > 1 ? 's' : ''}`)
                if (secs > 0 || parts.length === 0) parts.push(`${secs} second${secs > 1 ? 's' : ''}`)
                return parts.join(', ')
            }

            const timeStr = formatTime(retryAfter)
            const isApiRequest = c.req.path.startsWith('/api/') || 
                                c.req.header('accept')?.includes('application/json')

            if (isApiRequest) {
                return c.json({
                    success: false,
                    status: 429,
                    error: 'Too Many Requests',
                    message: `Rate limit exceeded. Maximum ${config.max} requests per ${config.windowMs / 60000} minutes. Please try again in ${timeStr}.`,
                    retryAfter,
                    limit: config.max,
                    windowMs: config.windowMs
                }, 429)
            }

            return c.text(`Too Many Requests. Retry after ${timeStr}.`, 429)
        }

        // Set rate limit headers for successful request
        c.header('X-RateLimit-Limit', config.max.toString())
        c.header('X-RateLimit-Remaining', Math.max(0, config.max - clientData.count).toString())

        await next()
    }
}

// Export config untuk bisa diakses/dimodifikasi dari luar jika diperlukan
export const rateLimitConfig = config
