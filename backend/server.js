require('dotenv').config(); // Load environment variables from .env file
// This is a dummy comment to trigger a new Vercel deployment
const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
// const bcrypt = require('bcrypt'); // No longer needed
// const jwt = require('jsonwebtoken'); // No longer needed

const app = express();
const PORT = process.env.PORT || 3000;
const db = new Database('cashplanner.db', { verbose: console.log });
// const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret'; // No longer needed
const GEMINI_API_KEY = process.env.GEMINI_API_KEY; // Get Gemini API key from .env

// Ensure API key is present
if (!GEMINI_API_KEY) {
    console.error('Error: GEMINI_API_KEY is not set in environment variables.');
    process.exit(1);
}

// Create users table if it doesn't exist (no longer needed for auth, but can keep for consistency if we add user profiles later)
// db.prepare(`
//     CREATE TABLE IF NOT EXISTS users (
//         id INTEGER PRIMARY KEY AUTOINCREMENT,
//         username TEXT UNIQUE NOT NULL,
//         password TEXT NOT NULL
//     )
// `).run();

// Create transactions table if it doesn't exist
db.prepare(`
    CREATE TABLE IF NOT EXISTS transactions (
        id TEXT PRIMARY KEY,
        userId INTEGER NOT NULL,
        name TEXT NOT NULL,
        amount REAL NOT NULL,
        type TEXT NOT NULL,
        startDate TEXT NOT NULL,
        frequency TEXT NOT NULL DEFAULT 'none',
        interval INTEGER NOT NULL DEFAULT 1,
        endDate TEXT,
        skipDates TEXT,
        modifications TEXT
        // FOREIGN KEY (userId) REFERENCES users(id) // No longer needed without auth
    )
`).run();

// Middleware
app.use(cors());
app.use(express.json()); // For parsing application/json

// No authentication middleware needed
// const authenticateToken = (req, res, next) => { /* ... */ };

// Basic route
app.get('/', (req, res) => {
    res.send('Cash Planner Backend API (Auth Disabled)');
});

// User Registration/Login routes removed
// app.post('/register', async (req, res) => { /* ... */ });
// app.post('/login', async (req, res) => { /* ... */ });

// --- Transaction Routes (Auth Removed) ---

// Get all transactions for a user (hardcoding userId = 1)
app.get('/transactions', (req, res) => {
    try {
        const stmt = db.prepare('SELECT * FROM transactions WHERE userId = 1'); // Hardcode userId
        const transactions = stmt.all();
        res.status(200).json(transactions.map(tx => ({
            ...tx,
            skipDates: JSON.parse(tx.skipDates || '[]'),
            modifications: JSON.parse(tx.modifications || '{}')
        })));
    } catch (error) {
        console.error('Get transactions error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Add a new transaction (hardcoding userId = 1)
app.post('/transactions', (req, res) => {
    const { id, name, amount, type, startDate, frequency, interval, endDate, skipDates, modifications } = req.body;

    if (!id || !name || isNaN(amount) || !type || !startDate || !frequency) {
        return res.status(400).json({ message: 'Missing required transaction fields' });
    }

    try {
        const stmt = db.prepare('INSERT INTO transactions (id, userId, name, amount, type, startDate, frequency, interval, endDate, skipDates, modifications) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        stmt.run(id, 1, name, amount, type, startDate, frequency, interval, endDate || null, JSON.stringify(skipDates || []), JSON.stringify(modifications || {})); // Hardcode userId
        res.status(201).json({ message: 'Transaction added successfully', transaction: req.body });
    } catch (error) {
        console.error('Add transaction error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Update a transaction (hardcoding userId = 1)
app.put('/transactions/:id', (req, res) => {
    const { id } = req.params;
    const { name, amount, type, startDate, frequency, interval, endDate, skipDates, modifications } = req.body;

    if (!name || isNaN(amount) || !type || !startDate || !frequency) {
        return res.status(400).json({ message: 'Missing required transaction fields' });
    }

    try {
        // No need to check userId for authorization, as auth is removed
        const stmt = db.prepare(
            'UPDATE transactions SET name = ?, amount = ?, type = ?, startDate = ?, frequency = ?, interval = ?, endDate = ?, skipDates = ?, modifications = ? WHERE id = ? AND userId = 1' // Hardcode userId
        );
        stmt.run(name, amount, type, startDate, frequency, interval, endDate || null, JSON.stringify(skipDates || []), JSON.stringify(modifications || {}), id);
        res.status(200).json({ message: 'Transaction updated successfully' });
    } catch (error) {
        console.error('Update transaction error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Delete a transaction (hardcoding userId = 1)
app.delete('/transactions/:id', (req, res) => {
    const { id } = req.params;

    try {
        // No need to check userId for authorization, as auth is removed
        const stmt = db.prepare('DELETE FROM transactions WHERE id = ? AND userId = 1'); // Hardcode userId
        stmt.run(id);
        res.status(200).json({ message: 'Transaction deleted successfully' });
    } catch (error) {
        console.error('Delete transaction error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// --- Gemini Chatbot Endpoint ---
app.post('/gemini-chat', async (req, res) => { // No authentication middleware needed
    const { chatHistory, systemPrompt } = req.body;

    if (!chatHistory || !systemPrompt) {
        return res.status(400).json({ message: 'Missing chat history or system prompt' });
    }

    const geminiApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${GEMINI_API_KEY}`;

    try {
        console.log('Making request to Gemini API:', geminiApiUrl);
        const response = await fetch(geminiApiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: chatHistory,
                systemInstruction: { parts: [{ text: systemPrompt }] }, // Re-add systemInstruction
                generationConfig: {
                    responseMimeType: "application/json", // Re-add responseMimeType
                    // Keep responseSchema removed for now, as it was causing issues
                }
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Gemini API response not OK:', response.status, errorText);
            throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
        }

        const result = await response.json();
        console.log('Gemini API call successful.');
        res.status(200).json(result);

    } catch (error) {
        console.error('Error in /gemini-chat endpoint:', error);
        res.status(500).json({ message: 'Internal server error', details: error.message });
    }
});

module.exports = app; // Export the app for Vercel
