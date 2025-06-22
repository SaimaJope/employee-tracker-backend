// index.js - The final, complete, and robust backend code

const express = require('express');
const { open } = require('sqlite');
const sqlite3 = require('sqlite3');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { setupDatabase } = require('./database');

// --- CONFIGURATION ---
const config = { JWT_SECRET: process.env.JWT_SECRET || 'your-default-dev-secret-key' };
const SUBSCRIPTION_PLANS = { 'tier1': { max_employees: 5 }, 'tier2': { max_employees: 10 }, 'tier3': { max_employees: 50 } };

// --- APP SETUP ---
const app = express();
app.use(cors());
app.use(express.json());
app.get('/', (req, res) => res.status(200).send({ status: 'ok' }));

// --- DATABASE PATH ---
const isProduction = process.env.NODE_ENV === 'production';
const dataDir = isProduction ? process.env.RENDER_DISK_PATH : __dirname;
const dbPath = path.join(dataDir, 'employee_tracker.db');

// --- MAIN SERVER FUNCTION ---
async function startServer() {
    // Open the database connection ONCE when the server starts.
    const db = await open({ filename: dbPath, driver: sqlite3.Database })
        .catch(err => { console.error(`FATAL: DB CONNECTION ERROR`, err); process.exit(1); });

    // Enable WAL mode for better concurrency.
    await db.run('PRAGMA journal_mode = WAL;');
    console.log(`Successfully connected to DB and enabled WAL mode.`);

    // Run database setup/migrations.
    await setupDatabase(db);

    // --- MIDDLEWARE ---
    // All middleware and routes are defined *inside* startServer to access the 'db' object.

    // Middleware for user authentication (Desktop App)
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

    // Middleware for Kiosk authentication (Android App)
    const authenticateKiosk = async (req, res, next) => {
        const apiKey = req.headers['x-api-key'];
        if (!apiKey) return res.status(401).json({ success: false, message: 'API Key is missing.' });
        try {
            const kiosk = await db.get('SELECT id, company_id FROM kiosks WHERE api_key = ?', apiKey);
            if (!kiosk) return res.status(403).json({ success: false, message: 'Invalid API Key.' });
            req.kiosk = kiosk;
            next();
        } catch (error) {
            console.error("Kiosk auth error:", error);
            res.status(500).json({ success: false, message: 'Server error during authentication.' });
        }
    };

    // Middleware to check employee limit (Desktop App)
    const checkEmployeeLimit = async (req, res, next) => {
        try {
            const company = await db.get('SELECT max_employees FROM companies WHERE id = ?', req.user.companyId);
            if (!company) return res.status(404).json({ message: "Company not found." });
            const countResult = await db.get('SELECT COUNT(*) AS count FROM employees WHERE company_id = ?', req.user.companyId);
            if (countResult.count >= company.max_employees) return res.status(403).json({ message: `Employee limit of ${company.max_employees} reached.` });
            next();
        } catch (error) {
            console.error("Error in checkEmployeeLimit:", error);
            res.status(500).json({ message: 'Error checking subscription.' });
        }
    };

    // --- API ROUTES ---

    // AUTH ROUTES (for Desktop App)
    app.post('/api/auth/register', async (req, res) => {
        const { companyName, email, password } = req.body;
        if (!companyName || !email || !password) return res.status(400).json({ message: "All fields are required." });
        try {
            await db.run('BEGIN TRANSACTION');
            const companyResult = await db.run('INSERT INTO companies (name, subscription_plan, max_employees) VALUES (?, ?, ?)', companyName, 'tier1', SUBSCRIPTION_PLANS['tier1'].max_employees);
            const newCompanyId = companyResult.lastID;
            const passwordHash = await bcrypt.hash(password, 10);
            await db.run('INSERT INTO users (company_id, email, password_hash) VALUES (?, ?, ?)', newCompanyId, email, passwordHash);
            const apiKey = crypto.randomBytes(16).toString('hex');
            await db.run('INSERT INTO kiosks (company_id, name, api_key) VALUES (?, ?, ?)', newCompanyId, 'Main Kiosk', apiKey);
            await db.run('COMMIT');
            res.status(201).json({ message: "Company, user, and kiosk registered successfully." });
        } catch (error) {
            await db.run('ROLLBACK');
            console.error("Registration Error:", error);
            if (error.code === 'SQLITE_CONSTRAINT') return res.status(409).json({ message: "Company or email already exists." });
            res.status(500).json({ message: "Failed to register." });
        }
    });

    app.post('/api/auth/login', async (req, res) => {
        try {
            const { email, password } = req.body;
            if (!email || !password) return res.status(400).json({ message: 'Email and password are required.' });
            const user = await db.get('SELECT * FROM users WHERE email = ?', email);
            if (!user) return res.status(401).json({ message: 'Invalid email or password.' });
            const isPasswordCorrect = await bcrypt.compare(password, user.password_hash);
            if (!isPasswordCorrect) return res.status(401).json({ message: 'Invalid email or password.' });
            const payload = { id: user.id, email: user.email, companyId: user.company_id };
            const token = jwt.sign(payload, config.JWT_SECRET, { expiresIn: '8h' });
            res.status(200).json({ message: 'Login successful!', token: token });
        } catch (error) {
            console.error('LOGIN ERROR', error);
            res.status(500).json({ message: 'An internal server error occurred.' });
        }
    });

    // EMPLOYEE ROUTES (for Desktop App)
    app.post('/api/employees', authenticateToken, checkEmployeeLimit, async (req, res) => {
        const { name, nfc_card_id } = req.body;
        if (!name || !nfc_card_id) {
            return res.status(400).json({ message: "Name and NFC card ID are required." });
        }
        try {
            await db.run('INSERT INTO employees (company_id, name, nfc_card_id) VALUES (?, ?, ?)', req.user.companyId, name, nfc_card_id);
            return res.status(201).json({ message: 'Employee added successfully.' });
        } catch (error) {
            console.error("Error during INSERT operation:", error);
            if (error.code === 'SQLITE_CONSTRAINT') {
                return res.status(409).json({ message: "Failed to add employee. That Card ID is already in use." });
            }
            return res.status(500).json({ message: "A server error occurred while adding the employee." });
        }
    });

    app.get('/api/employees', authenticateToken, async (req, res) => {
        try {
            const employees = await db.all('SELECT * FROM employees WHERE company_id = ? ORDER BY name', req.user.companyId);
            res.status(200).json(employees);
        } catch (error) {
            console.error("Error fetching employees:", error);
            res.status(500).json({ message: "Failed to fetch employee list." });
        }
    });

    app.delete('/api/employees/:id', authenticateToken, async (req, res) => {
        try {
            await db.run('DELETE FROM employees WHERE id = ? AND company_id = ?', req.params.id, req.user.companyId);
            res.status(200).json({ message: "Employee successfully removed." });
        } catch (error) {
            console.error("Error deleting employee:", error);
            res.status(500).json({ message: "Failed to delete employee." });
        }
    });

    // KIOSK ROUTES
    // For Android Kiosk App
    app.post('/api/kiosk/tap', authenticateKiosk, async (req, res) => {
        const { nfc_card_id } = req.body;
        if (!nfc_card_id) {
            return res.status(400).json({ success: false, message: "NFC Card ID is required." });
        }
        const { company_id, id: kiosk_id } = req.kiosk;
        try {
            const employee = await db.get('SELECT id, name FROM employees WHERE company_id = ? AND nfc_card_id = ?', company_id, nfc_card_id);
            if (!employee) {
                return res.status(404).json({ success: false, message: `Card not recognized.` });
            }
            const lastLog = await db.get('SELECT event_type FROM attendance_logs WHERE employee_id = ? ORDER BY timestamp DESC LIMIT 1', employee.id);
            const newEventType = (!lastLog || lastLog.event_type === 'clock-out') ? 'clock-in' : 'clock-out';
            await db.run('INSERT INTO attendance_logs (company_id, employee_id, kiosk_id, nfc_card_id, event_type) VALUES (?, ?, ?, ?, ?)', company_id, employee.id, kiosk_id, nfc_card_id, newEventType);
            const actionMessage = newEventType === 'clock-in' ? 'Clocked In' : 'Clocked Out';
            res.status(200).json({ success: true, message: `${employee.name}\n${actionMessage}`, employee_name: employee.name, action: newEventType });
        } catch (error) {
            console.error("Kiosk tap error:", error);
            res.status(500).json({ success: false, message: "Server error. Please try again." });
        }
    });

    // For Desktop App
    app.get('/api/kiosks', authenticateToken, async (req, res) => {
        try {
            const kiosks = await db.all('SELECT id, name, api_key, created_at FROM kiosks WHERE company_id = ?', req.user.companyId);
            res.status(200).json(kiosks);
        } catch (error) {
            console.error("Error fetching kiosks:", error);
            res.status(500).json({ message: "Failed to fetch kiosk list." });
        }
    });

    // LOGS ROUTE (for Desktop App)
    app.get('/api/logs', authenticateToken, async (req, res) => {
        try {
            const logs = await db.all(`
                SELECT 
                    al.id,
                    al.event_type,
                    al.timestamp,
                    al.nfc_card_id,
                    e.name as employee_name,
                    k.name as kiosk_name
                FROM attendance_logs al
                JOIN employees e ON al.employee_id = e.id
                LEFT JOIN kiosks k ON al.kiosk_id = k.id
                WHERE al.company_id = ?
                ORDER BY al.timestamp DESC
                LIMIT 100
            `, req.user.companyId);
            res.json(logs);
        } catch (error) {
            console.error("Error fetching logs:", error);
            res.status(500).json({ message: "Failed to fetch attendance logs." });
        }
    });

    // --- START SERVER ---
    const port = process.env.PORT || 10000;
    app.listen(port, () => console.log(`Server started on port ${port}`));
}

startServer();