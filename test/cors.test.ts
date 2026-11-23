import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.ts';

describe('CORS', () => {
    it('allows a configured origin with credentials', async () => {
        const res = await request(app).get('/health').set('Origin', 'http://localhost:5173');

        expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
        expect(res.headers['access-control-allow-credentials']).toBe('true');
    });

    it('does not allow an unknown origin', async () => {
        const res = await request(app).get('/health').set('Origin', 'https://evil.example');

        expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });
});
