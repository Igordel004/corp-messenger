import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from './app';

describe('Integration Test: Проверка маршрутов Express API (Supertest)', () => {
  it('GET /api/health возвращает HTTP 200 и корректный JSON-ответ', async () => {
    const response = await request(app).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: 'ok',
      service: 'corporate-messenger-api',
    });
  });
});
