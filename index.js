const express = require('express');
const { open } = require('sqlite');
const sqlite3 = require('sqlite3');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const config = require('./config');
const { setupDatabase } = require('./database');

const app = express();
app.use(cors());
app.use(express.json());

// Health Check Route
app.get('/', (req, res) => {
    res.status(200).send({ status: 'ok', message: 'Server is live!' });
});

const isProduction = process.env.NODE_ENV === 'production';
// This is the line that had the typo
const dataDir = isProduction ? process.env.RENDER_DISK_PATH : __dirname;
const dbPath = path.join(dataDir, 'employee_tracker.db');

async function startServer() {
    const db = await open({
        filename: dbPath,
        driver: sqlite3.Database
    }).catch(err => {
        console.error(`FATAL: DB connection error at ${dbPath}`, err);
        process.exit(1);
    });
    console.log(`Successfully connected to DB at ${dbPath}`);
    await setupDatabase(db);

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

    app.post('/api/auth/register', async (req, res) => {
        const { companyName, email, password } = req.body;
        if (!companyName || !email || !password) return res.status(400).json({ message: "All fields required." });
        try {
            const passwordHash = await bcrypt.hash(password, 10);
            await db.run('INSERT INTO companies (name) VALUES (?)', companyName);
            const newCompany = await db.get('SELECT id FROM companies WHERE name = ?', companyName);
            if (!newCompany) throw new Error("Failed to create company.");
            const companyId = newCompany.id;
            await db.run('INSERT INTO users (company_id, email, password_hash) VALUES (?, ?, ?)', [companyId, email, passwordHash]);
            const apiKey = crypto.randomBytes(16).toString('hex');
            await db.run('INSERT INTO kiosks (company_id, name, api_key) VALUES (?, ?, ?)', [companyId, 'Main Kiosk', apiKey]);
            res.status(201).json({ message: "Company registered successfully." });
        } catch (error) {
            console.error("REGISTRATION ERROR:", error);
            res.status(500).json({ message: "Registration failed." });
        }
    });

    app.post('/api/auth/login', async (req, res) => {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ message: "Email/password required." });
        try {
            const user = await db.get('SELECT * FROM users WHERE email = ?', email);
            if (!user) return res.status(401).json({ message: "Invalid credentials." });
            const passOk = await bcrypt.compare(password, user.password_hash);
            if (!passOk) return res.status(401).json({ message: "Invalid credentials." });
            const token = jwt.sign({ userId: user.id, companyId: user.company_id }, config.JWT_SECRET, { expiresIn: '8h' });
            res.json({ message: "Login successful!", token });
        } catch (error) {
            console.error("LOGIN ERROR:", error);
            res.status(500).json({ message: "Login failed." });
        }
    });

    app.get('/api/logs', authenticateToken, async (req, res) => {
        try {
            const logs = await db.all(`
                SELECT al.id, al.nfc_card_id, al.event_type, al.timestamp, e.name as employee_name 
                FROM attendance_logs al LEFT JOIN employees e ON al.employee_id = e.id 
                WHERE al.company_id = ? ORDER BY al.timestamp DESC`,
                req.user.companyId
            );
            res.json(logs);
        } catch (error) {
            console.error("Error fetching logs:", error);
            res.status(500).json({ error: "Failed to retrieve logs." });
        }
    });

    app.get('/api/employees', authenticateToken, async (req, res) => {
        try {
            const employees = await db.all('SELECT * FROM employees WHERE company_id = ? ORDER BY name', req.user.companyId);
            res.json(employees);
        } catch (error) {
            console.error("Error fetching employees:", error);
            res.status(500).json({ error: "Failed to retrieve employees." });
        }
    });

    app.post('/api/employees', authenticateToken, async (req, res) => {
        const { name, nfc_card_id } = req.body;
        if (!name || !nfc_card_id) return res.status(400).json({ error: "Name and card ID required." });
        try {
            const result = await db.run('INSERT INTO employees (company_id, name, nfc_card_id) VALUES (?, ?, ?)', [req.user.companyId, name, nfc_card_id]);
            res.status(201).json({ message: 'Employee added.' });
        } catch (error) {
            console.error("Error adding employee:", error);
            res.status(500).json({ error: "Failed to add employee." });
        }
    });

    // Add this with your other secured routes (like /api/employees)
    app.get('/api/kiosks', authenticateToken, async (req, res) => {
        try {
            const kiosks = await db.all('SELECT id, name, api_key, created_at FROM kiosks WHERE company_id = ?', req.user.companyId);
            res.json(kiosks);
        } catch (error) {
            console.error("Error fetching kiosks:", error);
            res.status(500).json({ message: "Failed to retrieve kiosks." });
        }
    });

    // This is the new, secure tap endpoint for the KIOSK
    app.post('/api/kiosk/tap', async (req, res) => {
        // The Kiosk will send its API key in the headers
        const apiKey = req.headers['x-api-key'];
        const { nfc_card_id } = req.body;

        if (!apiKey || !nfc_card_id) {
            return res.status(400).json({ message: "API key and NFC card ID are required." });
        }

        try {
            // Step 1: Find the kiosk and its company based on the API key
            const kiosk = await db.get('SELECT * FROM kiosks WHERE api_key = ?', apiKey);
            if (!kiosk) {
                return res.status(401).json({ message: "Invalid API Key." });
            }
            const companyId = kiosk.company_id;

            // Step 2: Find the employee WITHIN THAT COMPANY
            const employee = await db.get(
                'SELECT * FROM employees WHERE nfc_card_id = ? AND company_id = ?',
                [nfc_card_id, companyId]
            );
            if (!employee) {
                return res.status(404).json({ success: false, message: 'Card not registered for this company.' });
            }

            // Step 3: Run the cooldown and check-in/out logic (this is the same as before)
            const timeDiffCheck = await db.get(
                `SELECT (strftime('%s', 'now') - strftime('%s', timestamp)) / 60.0 as minutes_ago 
             FROM attendance_logs WHERE employee_id = ? ORDER BY timestamp DESC LIMIT 1`,
                employee.id
            );
            if (timeDiffCheck && timeDiffCheck.minutes_ago < 10) {
                return res.status(429).json({ success: false, message: `Cooldown active.` });
            }

            const lastLog = await db.get(`SELECT event_type FROM attendance_logs WHERE employee_id = ? ORDER BY timestamp DESC LIMIT 1`, employee.id);
            const newEventType = (!lastLog || lastLog.event_type === 'check-out') ? 'check-in' : 'check-out';

            await db.run(
                `INSERT INTO attendance_logs (company_id, employee_id, kiosk_id, nfc_card_id, event_type) VALUES (?, ?, ?, ?, ?)`,
                [companyId, employee.id, kiosk.id, nfc_card_id, newEventType]
            );

            const message = `Welcome, ${employee.name}!`;
            res.json({ success: true, message: message, employee_name: employee.name, action: newEventType });

        } catch (error) {
            console.error("KIOSK TAP ERROR:", error);
            res.status(500).json({ message: "An error occurred during the tap event." });
        }
    });
}

startServer();