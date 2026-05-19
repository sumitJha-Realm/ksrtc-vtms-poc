const { MongoClient } = require('mongodb');
require('dotenv').config();

let client;
let db;

async function connectDB() {
  if (db) return db;
  client = new MongoClient(process.env.MONGODB_URI, {
    maxPoolSize: 50,
    minPoolSize: 5,
    maxIdleTimeMS: 30000,
    retryWrites: true,
    retryReads: true
  });
  await client.connect();
  db = client.db(process.env.DB_NAME);
  console.log('Connected to MongoDB Atlas');
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
