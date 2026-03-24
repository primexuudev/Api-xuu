import { createRoute, z } from '@hono/zod-openapi'
import axios from 'axios'
import { MediaSchema } from '../../utils/media.js'

export const blueArchiveRandomRoute = createRoute({
    method: 'get',
    path: '/api/ba',
    tags: ['random'],
    description: 'Get a random Blue Archive media asset',
    'x-status': 'ONLINE',
    'x-auto-media': true,
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: MediaSchema
                }
            },
            description: 'Success',
        },
        500: {
            content: {
                'application/json': {
                    schema: z.object({
                        error: z.string().openapi({ example: 'Internal Server Error' }),
                        message: z.string()
                    }),
                },
            },
            description: 'Internal Server Error',
        }
    },
})

export const blueArchiveRandomHandler = async (c) => {
    try {
        const ENDPOINT = 'https://raw.githubusercontent.com/yemo-dev/blue-archive-r-img/main/links.json'
        const response = await axios.get(ENDPOINT)
        const items = response.data

        if (!Array.isArray(items) || items.length === 0) {
            throw new Error('No assets found in the database')
        }

        const randomAsset = items[Math.floor(Math.random() * items.length)]

        return randomAsset
    } catch (error) {
        return c.json({
            error: 'Internal Server Error',
            message: error.message
        }, 500)
    }
}
