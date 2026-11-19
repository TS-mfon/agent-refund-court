import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createRuntimeApp } from '../../src/runtime.js';
test('unconfigured local viewer advertises disabled purchases and serves empty cases',async()=>{
 const app=createRuntimeApp({});
 const service=await request(app).get('/api/v1/service').expect(200);
 assert.equal(service.body.service.capabilities.purchase,false);
 assert.deepEqual((await request(app).get('/api/v1/cases').expect(200)).body,{cases:[]});
 await request(app).post('/api/v1/orders').send({}).expect(401);
});
test('hosted runtime cannot silently substitute in-memory storage',()=>{
 assert.throws(()=>createRuntimeApp({VERCEL:'1'}),/Production storage required/);
});
