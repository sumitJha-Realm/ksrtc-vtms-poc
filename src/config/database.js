const { MongoClient } = require('mongodb');
require('dotenv').config();
const { recordDbTiming } = require('../services/timingMetrics');

let client;
let db;

const DB_TIMING_ENABLED = (process.env.DB_TIMING_ENABLED || 'true') === 'true';
const DB_TIMING_MIN_MS = Number(process.env.DB_TIMING_MIN_MS || 20);
const DB_TIMING_VERBOSE = (process.env.DB_TIMING_VERBOSE || 'false') === 'true';

function attachDbTimingListeners(mongoClient) {
  if (!DB_TIMING_ENABLED) return;

  const startedAt = new Map(); // requestId -> start timestamp (ms)
  const shouldLogCommand = (name) => {
    const tracked = new Set([
      'find', 'insert', 'update', 'delete', 'aggregate', 'findAndModify',
      'count', 'distinct', 'bulkWrite', 'createIndexes', 'dropIndexes',
      'watch', 'getMore'
    ]);
    return tracked.has(name) || DB_TIMING_VERBOSE;
  };

  mongoClient.on('commandStarted', (e) => {
    if (!shouldLogCommand(e.commandName)) return;
    startedAt.set(e.requestId, Date.now());
  });

  mongoClient.on('commandSucceeded', (e) => {
    const start = startedAt.get(e.requestId);
    if (!start) return;
    startedAt.delete(e.requestId);

    const durationMs = Date.now() - start;
    if (durationMs < DB_TIMING_MIN_MS && !DB_TIMING_VERBOSE) return;

    const ns = e.databaseName ? `${e.databaseName}.${e.commandName}` : e.commandName;
    console.log(`[DB-TIMING] ok ${ns} ${durationMs}ms`);
    recordDbTiming({
      commandName: e.commandName,
      databaseName: e.databaseName,
      durationMs,
      ok: true
    });
  });

  mongoClient.on('commandFailed', (e) => {
    const start = startedAt.get(e.requestId);
    if (!start) return;
    startedAt.delete(e.requestId);

    const durationMs = Date.now() - start;
    const ns = e.databaseName ? `${e.databaseName}.${e.commandName}` : e.commandName;
    console.error(`[DB-TIMING] fail ${ns} ${durationMs}ms: ${e.failure?.message || 'command failed'}`);
    recordDbTiming({
      commandName: e.commandName,
      databaseName: e.databaseName,
      durationMs,
      ok: false,
      error: e.failure?.message || 'command failed'
    });
  });
}

async function connectDB() {
  if (db) return db;
  client = new MongoClient(process.env.MONGODB_URI, {
    maxPoolSize: 50,
    minPoolSize: 5,
    maxIdleTimeMS: 30000,
    retryWrites: true,
    retryReads: true,
    monitorCommands: DB_TIMING_ENABLED
  });
  attachDbTimingListeners(client);
  await client.connect();
  db = client.db((process.env.DB_NAME || 'ksrtc_vtms').trim());
  console.log('Connected to MongoDB Atlas, db:', db.databaseName);
  return db;
}

function getDB() {
  if (!db) throw new Error('Database not connected');
  return db;
}

function getClient() {
  return client;
}

async function closeDB() {
  if (client) await client.close();
}

module.exports = { connectDB, getDB, getClient, closeDB };
