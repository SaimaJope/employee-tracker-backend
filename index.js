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

const app = express();
app.use(cors());
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

    const checkEmployeeLimit = async (req, res, next) => {
        try {
            const company = await db.get('SELECT max_employees FROM companies WHERE id = ?', req.user.companyId);
            if (!company) return res.status(404).json({ message: "Company not found." });
            const countResult = await db.get('SELECT COUNT(*) AS count FROM employees WHERE company_id = ?', req.user.companyId);
            const currentEmployees = countResult ? countResult.count : 0;
            if (currentEmployees >= company.max_employees) {
                return res.status(403).json({ message: `Employee limit of ${company.max_employees} reached.` });
            }
            next();
        } catch (error) {
            console.error("Subscription check failed:", error);
            return res.status(500).json({ message: "Error checking subscription status." });
        }
    };

    app.post('/api/auth/register', async (req, res) => {
        const { companyName, email, password } = req.body;
        if (!companyName || !email || !password) return res.status(400).json({ message: "All fields required." });
        try {
            const passwordHash = await bcrypt.hash(password, 10);
            await db.run('INSERT INTO companies (name) VALUES (?)', companyName);
            const newCompany = await db.get('SELECT id FROM companies WHERE name = ?', companyName);
            if (!newCompany) throw new Error("Failed to create/retrieve company.");
            const companyId = newCompany.id;
            await db.run('INSERT INTO users (company_id, email, password_hash) VALUES (?, ?, ?)', [companyId, email, passwordHash]);
            const apiKey = crypto.randomBytes(16).toString('hex');
            await db.run('INSERT INTO kiosks (company_id, name, api_key) VALUES (?, ?, ?)', [companyId, 'Main Kiosk', apiKey]);
            res.status(201).json({ message: "Company registered successfully." });
        } catch (error) {
            res.status(500).json({ message: "Registration failed.", details: error.message });
        }
    });

    app.post('/api/auth/login', async (req, res) => {
        const { email, password } = req.body;
        try {
            const user = await db.get('SELECT * FROM users WHERE email = ?', email);
            if (!user) return res.status(401).json({ message: "Invalid credentials." });
            const passOk = await bcrypt.compare(password, user.password_hash);
            if (!passOk) return res.status(401).json({ message: "Invalid credentials." });
            const token = jwt.sign({ userId: user.id, companyId: user.company_id }, config.JWT_SECRET, { expiresIn: '8h' });
            res.json({ message: "Login successful!", token });
        } catch (error) {
            res.status(500).json({ message: "Login failed." });
        }
    });

    app.get('/api/kiosks', authenticateToken, async (req, res) => {
        const kiosks = await db.all('SELECT id, name, api_key, created_at FROM kiosks WHERE company_id = ?', req.user.companyId);
        res.json(kiosks);
    });

    app.get('/api/logs', authenticateToken, async (req, res) => {
        const logs = await db.all(`SELECT al.id, al.nfc_card_id, al.event_type, al.timestamp, e.name as employee_name FROM attendance_logs al LEFT JOIN employees e ON al.employee_id = e.id WHERE al.company_id = ? ORDER BY al.timestamp DESC`, req.user.companyId);
        res.json(logs);
    });

    app.get('/api/employees', authenticateToken, async (req, res) => {
        const employees = await db.all('SELECT * FROM employees WHERE company_id = ? ORDER BY name', req.user.companyId);
        res.json(employees);
    });

    app.post('/api/employees', authenticateToken, checkEmployeeLimit, async (req, res) => {
        const { name, nfc_card_id } = req.body;
        try {
            await db.run('INSERT INTO employees (company_id, name, nfc_card_id) VALUES (?, ?, ?)', [req.user.companyId, name, nfc_card_id]);
            res.status(201).json({ message: 'Employee added.' });
        } catch (error) {
            res.status(500).json({ message: "Failed to add employee." });
        }
    });

    app.delete('/api/employees/:id', authenticateToken, async (req, res) => {
        const result = await db.run('DELETE FROM employees WHERE id = ? AND company_id = ?', [req.params.id, req.user.companyId]);
        if (result.changes === 0) return res.status(404).json({ message: "Employee not found." });
        res.status(200).json({ message: 'Employee deleted.' });
    });

    // We will fix this last
    app.post('/api/kiosk/tap', (req, res) => res.status(501).json({ message: "Tap endpoint not fully implemented yet." }));

    const port = process.env.PORT || 3001;
    app.listen(port, () => console.log(`Server started on port ${port}`));
}

startServer();