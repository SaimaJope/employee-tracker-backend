// index.js - The final, complete, and verified version

const express = require('express');
const { open } = require('sqlite');
const sqlite3 = require('sqlite3');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { setupDatabase } = require('./database');

const config = {
    JWT_SECRET: process.env.JWT_SECRET || 'your-default-dev-secret-key'
};

const SUBSCRIPTION_PLANS = {
    'tier1': { max_employees: 5 },
    'tier2': { max_employees: 10 },
    'tier3': { max_employees: 50 }
};

const app = express();
app.use(cors()); // Using simple cors for now, which allows all origins. This is fine.
app.use(express.json());

app.get('/', (req, res) => {
    res.status(200).send({ status: 'ok' });
});

const isProduction = process.env.NODE_ENV === 'production';
const dataDir = isProduction ? process.env.RENDER_DISK_PATH : __dirname;
const dbPath = path.join(dataDir, 'employee_tracker.db');

async function startServer() {
    const db = await open({
        filename: dbPath,
        driver: sqlite3.Database
    }).catch(err => {
        console.error(`FATAL: DB connection error`, err);
        process.exit(1);
    });
    console.log(`Successfully connected to DB`);
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

    const checkEmployeeLimit = async (req, res, next) => {
        try {
            if (!req.user || !req.user.companyId) return res.status(401).json({ message: "Invalid user token." });
            const company = await db.get('SELECT max_employees FROM companies WHERE id = ?', req.user.companyId);
            if (!company) return res.status(404).json({ message: "Company not found." });
            const countResult = await db.get('SELECT COUNT(*) AS count FROM employees WHERE company_id = ?', req.user.companyId);
            if (countResult.count >= company.max_employees) return res.status(403).json({ message: `Employee limit of ${company.max_employees} reached.` });
            next();
        } catch (error) {
            console.error("ERROR in checkEmployeeLimit:", error);
            return res.status(500).json({ message: "Error checking subscription status." });
        }
    };

    // --- API ROUTES ---

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

    // All other authenticated routes
    app.get('/api/logs', authenticateToken, async (req, res) => { try { const logs = await db.all(`SELECT al.id, al.event_type, al.timestamp, al.nfc_card_id, e.name AS employee_name FROM attendance_logs AS al LEFT JOIN employees AS e ON al.employee_id = e.id WHERE al.company_id = ? ORDER BY al.timestamp DESC LIMIT 100`, req.user.companyId); res.json(logs); } catch (error) { res.status(500).json({ message: "Failed to fetch logs." }); } });
    app.get('/api/kiosks', authenticateToken, async (req, res) => { try { const kiosks = await db.all('SELECT * FROM kiosks WHERE company_id = ?', req.user.companyId); res.json(kiosks); } catch (error) { res.status(500).json({ message: "Failed to fetch kiosks." }); } });
    app.get('/api/employees', authenticateToken, async (req, res) => { const employees = await db.all('SELECT * FROM employees WHERE company_id = ? ORDER BY name', req.user.companyId); res.json(employees); });
    app.post('/api/employees', authenticateToken, checkEmployeeLimit, async (req, res) => { try { const { name, nfc_card_id } = req.body; if (!name || !nfc_card_id) return res.status(400).json({ message: "Name and NFC card ID are required." }); await db.run('INSERT INTO employees (company_id, name, nfc_card_id) VALUES (?, ?, ?)', req.user.companyId, name, nfc_card_id); res.status(201).json({ message: 'Employee added successfully.' }); } catch (error) { res.status(500).json({ message: "Failed to add employee. Card ID might be in use." }); } });
    app.delete('/api/employees/:id', authenticateToken, async (req, res) => { try { const result = await db.run('DELETE FROM employees WHERE id = ? AND company_id = ?', req.params.id, req.user.companyId); if (result.changes === 0) return res.status(404).json({ message: "Employee not found." }); res.status(200).json({ message: "Employee deleted." }); } catch (error) { res.status(500).json({ message: "Failed to delete employee." }); } });
    app.put('/api/company/subscription', authenticateToken, async (req, res) => { try { const { plan } = req.body; if (!plan || !SUBSCRIPTION_PLANS[plan]) return res.status(400).json({ message: 'Invalid plan.' }); const newMaxEmployees = SUBSCRIPTION_PLANS[plan].max_employees; await db.run('UPDATE companies SET subscription_plan = ?, max_employees = ? WHERE id = ?', plan, newMaxEmployees, req.user.companyId); res.status(200).json({ message: `Subscription updated to ${plan}.`, new_limit: newMaxEmployees }); } catch (error) { res.status(500).json({ message: 'Failed to update subscription.' }); } });

    const port = process.env.PORT || 10000; // Render uses port 10000
    app.listen(port, () => console.log(`Server started on port ${port}`));
}

startServer();