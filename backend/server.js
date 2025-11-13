require('dotenv').config(); // Load environment variables from .env file
const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;
const db = new Database('cashplanner.db', { verbose: console.log });
const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret'; // Use environment variable
const GEMINI_API_KEY = process.env.GEMINI_API_KEY; // Get Gemini API key from .env

// Ensure API key is present
if (!GEMINI_API_KEY) {
    console.error('Error: GEMINI_API_KEY is not set in environment variables.');
    process.exit(1);
}

// Create users table if it doesn't exist
db.prepare(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL
    )
`).run();

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
        modifications TEXT,
        FOREIGN KEY (userId) REFERENCES users(id)
    )
`).run();

// Middleware
app.use(cors());
app.use(express.json()); // For parsing application/json

// Middleware to authenticate JWT
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token == null) return res.sendStatus(401); // No token

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403); // Token no longer valid
        req.user = user; // Attach user payload to request
        next();
    });
};

// Basic route
app.get('/', (req, res) => {
    res.send('Cash Planner Backend API');
});

// User Registration
app.post('/register', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ message: 'Username and password are required' });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const stmt = db.prepare('INSERT INTO users (username, password) VALUES (?, ?)');
        stmt.run(username, hashedPassword);
        res.status(201).json({ message: 'User registered successfully' });
    } catch (error) {
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            return res.status(409).json({ message: 'Username already exists' });
        }
        console.error('Registration error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// User Login
app.post('/login', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ message: 'Username and password are required' });
    }

    try {
        const stmt = db.prepare('SELECT * FROM users WHERE username = ?');
        const user = stmt.get(username);

        if (!user) {
            return res.status(400).json({ message: 'Invalid credentials' });
        }

        const isPasswordValid = await bcrypt.compare(password, user.password);

        if (!isPasswordValid) {
            return res.status(400).json({ message: 'Invalid credentials' });
        }

        // Generate JWT token
        const accessToken = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '1h' });

        res.status(200).json({ message: 'Login successful', accessToken: accessToken });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// --- Protected Transaction Routes ---

// Get all transactions for a user
app.get('/transactions', authenticateToken, (req, res) => {
    try {
        const stmt = db.prepare('SELECT * FROM transactions WHERE userId = ?');
        const transactions = stmt.all(req.user.id);
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

// Add a new transaction
app.post('/transactions', authenticateToken, (req, res) => {
    const { id, name, amount, type, startDate, frequency, interval, endDate, skipDates, modifications } = req.body;

    if (!id || !name || isNaN(amount) || !type || !startDate || !frequency) {
        return res.status(400).json({ message: 'Missing required transaction fields' });
    }

    try {
        const stmt = db.prepare('INSERT INTO transactions (id, userId, name, amount, type, startDate, frequency, interval, endDate, skipDates, modifications) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        stmt.run(id, req.user.id, name, amount, type, startDate, frequency, interval, endDate || null, JSON.stringify(skipDates || []), JSON.stringify(modifications || {}));
        res.status(201).json({ message: 'Transaction added successfully', transaction: req.body });
    } catch (error) {
        console.error('Add transaction error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Update a transaction
app.put('/transactions/:id', authenticateToken, (req, res) => {
    const { id } = req.params;
    const { name, amount, type, startDate, frequency, interval, endDate, skipDates, modifications } = req.body;

    if (!name || isNaN(amount) || !type || !startDate || !frequency) {
        return res.status(400).json({ message: 'Missing required transaction fields' });
    }

    try {
        const existingTx = db.prepare('SELECT userId FROM transactions WHERE id = ?').get(id);
        if (!existingTx || existingTx.userId !== req.user.id) {
            return res.status(404).json({ message: 'Transaction not found or unauthorized' });
        }

        const stmt = db.prepare(
            'UPDATE transactions SET name = ?, amount = ?, type = ?, startDate = ?, frequency = ?, interval = ?, endDate = ?, skipDates = ?, modifications = ? WHERE id = ? AND userId = ?'
        );
        stmt.run(name, amount, type, startDate, frequency, interval, endDate || null, JSON.stringify(skipDates || []), JSON.stringify(modifications || {}), id, req.user.id);
        res.status(200).json({ message: 'Transaction updated successfully' });
    } catch (error) {
        console.error('Update transaction error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Delete a transaction
app.delete('/transactions/:id', authenticateToken, (req, res) => {
    const { id } = req.params;

    try {
        const existingTx = db.prepare('SELECT userId FROM transactions WHERE id = ?').get(id);
        if (!existingTx || existingTx.userId !== req.user.id) {
            return res.status(404).json({ message: 'Transaction not found or unauthorized' });
        }

        const stmt = db.prepare('DELETE FROM transactions WHERE id = ? AND userId = ?');
        stmt.run(id, req.user.id);
        res.status(200).json({ message: 'Transaction deleted successfully' });
    } catch (error) {
        console.error('Delete transaction error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// --- Gemini Chatbot Endpoint ---
app.post('/gemini-chat', authenticateToken, async (req, res) => {
    const { chatHistory, systemPrompt } = req.body;

    if (!chatHistory || !systemPrompt) {
        return res.status(400).json({ message: 'Missing chat history or system prompt' });
    }

    const geminiApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${GEMINI_API_KEY}`;

    try {
        const response = await fetch(geminiApiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: chatHistory,
                systemInstruction: { parts: [{ text: systemPrompt }] },
                generationConfig: {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: "OBJECT",
                        properties: {
                            "type": { "type": "STRING" },
                            "question": { "type": "STRING" },
                            "transactions": {
                                type: "ARRAY",
                                items: {
                                    type: "OBJECT",
                                    properties: {
                                        "name": { "type": "STRING" },
                                        "amount": { "type": "NUMBER" },
                                        "type": { "type": "STRING", "enum": ["income", "expense"] },
                                        "startDate": { "type": "STRING" },
                                        "frequency": { "type": "STRING", "enum": ["none", "days", "weeks", "months"] },
                                        "interval": { "type": "NUMBER" }
                                    },
                                    "required": ["name", "amount", "type", "startDate", "frequency"]
                                }
                            }
                        },
                        "required": ["type"]
                    }
                }
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Gemini API error:', response.status, errorText);
            throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
        }

        const result = await response.json();
        res.status(200).json(result);

    } catch (error) {
        console.error('Error in /gemini-chat:', error);
        res.status(500).json({ message: 'Internal server error', details: error.message });
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
