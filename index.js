// --- All required modules ---
const express = require('express');
const { open } = require('sqlite');
const sqlite3 = require('sqlite3');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const config = require('./config');

const app = express();
app.use(cors());
app.use(express.json());

// --- Production-ready configuration ---
const isProduction = process.env.NODE_ENV === 'production';
const dataDir = isProduction ? (process.env.RENDER_DISK_PATH || '/var/data') : __dirname;
const dbPath = path.join(dataDir, 'employee_tracker.db');

async function startServer() {
    const db = await open({
        filename: dbPath,
        driver: sqlite3.Database
    }).catch(err => {
        // This is the line we are fixing
        console.error(`FATAL: Failed to open the database at ${dbPath}`, err);
        process.exit(1);
    });

    console.log('Successfully connected to the database.');

    // =================================================================
    // == AUTHENTICATION ROUTES (Public) ==
    // =================================================================

    app.post('/api/auth/register', async (req, res) => {
        const { companyName, email, password } = req.body;
        if (!companyName || !email || !password) return res.status(400).json({ message: "All fields are required." });
        const passwordHash = await bcrypt.hash(password, 10);
        try {
            await db.run('BEGIN TRANSACTION');
            const companyResult = await db.run('INSERT INTO companies (name) VALUES (?)', companyName);
            const companyId = companyResult.lastID;
            await db.run('INSERT INTO users (company_id, email, password_hash) VALUES (?, ?, ?)', [companyId, email, passwordHash]);
            const apiKey = crypto.randomBytes(16).toString('hex');
            await db.run('INSERT INTO kiosks (company_id, name, api_key) VALUES (?, ?, ?)', [companyId, 'Main Kiosk', apiKey]);
            await db.run('COMMIT');
            res.status(201).json({ message: "Company registered successfully." });
        } catch (error) {
            await db.run('ROLLBACK');
            res.status(500).json({ message: "Registration failed." });
        }
    });

    app.post('/api/auth/login', async (req, res) => {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ message: "Email and password are required." });
        const user = await db.get('SELECT * FROM users WHERE email = ?', email);
        if (!user) return res.status(401).json({ message: "Invalid credentials." });
        const isPasswordCorrect = await bcrypt.compare(password, user.password_hash);
        if (!isPasswordCorrect) return res.status(401).json({ message: "Invalid credentials." });
        const payload = { userId: user.id, companyId: user.company_id };
        const token = jwt.sign(payload, config.JWT_SECRET, { expiresIn: '8h' });
        res.json({ message: "Login successful!", token: token });
    });

    // ==============================================================
    // == SECURE MIDDLEWARE ==
    // ==============================================================

    const authenticateToken = (req, res, next) => {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];
        if (token == null) return res.sendStatus(401);
        jwt.verify(token, config.JWT_SECRET, (err, user) => {
            if (err) return res.sendStatus(403);
            req.user = user;
            next();
        });
    };

    // ==============================================================
    // == SECURED API ROUTES ==
    // ==============================================================

    app.get('/api/logs', authenticateToken, async (req, res) => {
        // Now uses req.user.companyId from the token
        const logs = await db.all(`SELECT al.id, al.nfc_card_id, al.event_type, al.timestamp, e.name as employee_name FROM attendance_logs al LEFT JOIN employees e ON al.employee_id = e.id WHERE al.company_id = ? ORDER BY al.timestamp DESC`, req.user.companyId);
        res.json(logs);
    });

    app.get('/api/employees', authenticateToken, async (req, res) => {
        const employees = await db.all('SELECT * FROM employees WHERE company_id = ? ORDER BY name', req.user.companyId);
        res.json(employees);
    });

    app.post('/api/employees', authenticateToken, async (req, res) => {
        const { name, nfc_card_id } = req.body;
        const result = await db.run('INSERT INTO employees (company_id, name, nfc_card_id) VALUES (?, ?, ?)', [req.user.companyId, name, nfc_card_id]);
        res.status(201).json({ message: 'Employee added.', employee_id: result.lastID });
    });

    // We still need to secure the tap endpoint
    app.post('/api/tap', async (req, res) => {
        // ... our existing tap logic ...
    });

    // --- Start Listening ---
    const port = process.env.PORT || 3001;
    app.listen(port, () => {
        console.log(`Server successfully started at http://localhost:${port}`);
    });
}

// --- Start the application ---
startServer();