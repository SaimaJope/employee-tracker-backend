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
    res.status(200).send({ status: 'ok' });
});

const isProduction = process.env.NODE_ENV === 'production';
const dataDir = isProduction ? process.env.RENDER_DISK_PATH : __dirname;
const dbPath = path.join(dataDir, 'employee_tracker.db');

async function startServer() {
    // Open & initialize DB
    const db = await open({
        filename: dbPath,
        driver: sqlite3.Database
    }).catch(err => {
        console.error(`FATAL: DB connection error at ${dbPath}`, err);
        process.exit(1);
    });
    console.log(`Successfully connected to DB at ${dbPath}`);
    await setupDatabase(db);

    // --- AUTHENTICATION MIDDLEWARE ---
    const authenticateToken = (req, res, next) => {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];
        if (!token) return res.sendStatus(401);
        jwt.verify(token, config.JWT_SECRET, (err, user) => {
            if (err) return res.sendStatus(403);
            req.user = user;
            next();
        });
    };

    // --- Final, bulletproof subscription check middleware ---
    const checkEmployeeLimit = async (req, res, next) => {
        const companyId = req.user.companyId;

        try {
            // Get the company's plan details
            const company = await db.get(
                'SELECT max_employees FROM companies WHERE id = ?',
                companyId
            );
            if (!company || typeof company.max_employees === 'undefined') {
                return res.status(404).json({ message: "Could not determine subscription plan." });
            }

            // Get the current employee count
            const employeeCountResult = await db.get(
                'SELECT COUNT(*) AS count FROM employees WHERE company_id = ?',
                companyId
            );
            // This is the key fix: Safely get the count, defaulting to 0 if the result is strange
            const currentEmployees = employeeCountResult ? employeeCountResult.count : 0;

            console.log(`Company ${companyId}: Limit is ${company.max_employees}, Current count is ${currentEmployees}`);

            if (currentEmployees >= company.max_employees) {
                return res.status(403).json({
                    message: `Employee limit of ${company.max_employees} reached. Please upgrade.`
                });
            }

            // All checks passed, proceed to the next step (the actual route handler)
            next();

        } catch (error) {
            console.error("CRITICAL: Employee limit check failed:", error);
            res.status(500).json({ message: "Server error while checking subscription." });
        }
    };

    // --- AUTH ROUTES ---
    app.post('/api/auth/register', async (req, res) => {
        const { companyName, email, password } = req.body;
        if (!companyName || !email || !password)
            return res.status(400).json({ message: "All fields required." });
        try {
            const passwordHash = await bcrypt.hash(password, 10);
            await db.run('INSERT INTO companies (name) VALUES (?)', companyName);
            const newCompany = await db.get('SELECT id FROM companies WHERE name = ?', companyName);
            if (!newCompany) throw new Error("Failed to create company.");
            const companyId = newCompany.id;
            await db.run(
                'INSERT INTO users (company_id, email, password_hash) VALUES (?, ?, ?)',
                [companyId, email, passwordHash]
            );
            const apiKey = crypto.randomBytes(16).toString('hex');
            await db.run(
                'INSERT INTO kiosks (company_id, name, api_key) VALUES (?, ?, ?)',
                [companyId, 'Main Kiosk', apiKey]
            );
            res.status(201).json({ message: "Company registered successfully." });
        } catch (error) {
            console.error("REGISTRATION ERROR:", error);
            res.status(500).json({ message: "Registration failed." });
        }
    });

    app.post('/api/auth/login', async (req, res) => {
        const { email, password } = req.body;
        if (!email || !password)
            return res.status(400).json({ message: "Email/password required." });
        try {
            const user = await db.get('SELECT * FROM users WHERE email = ?', email);
            if (!user) return res.status(401).json({ message: "Invalid credentials." });
            const passOk = await bcrypt.compare(password, user.password_hash);
            if (!passOk) return res.status(401).json({ message: "Invalid credentials." });
            const token = jwt.sign(
                { userId: user.id, companyId: user.company_id },
                config.JWT_SECRET,
                { expiresIn: '8h' }
            );
            res.json({ message: "Login successful!", token });
        } catch (error) {
            console.error("LOGIN ERROR:", error);
            res.status(500).json({ message: "Login failed." });
        }
    });

    // --- SECURED ROUTES ---
    app.get('/api/kiosks', authenticateToken, async (req, res) => {
        try {
            const kiosks = await db.all(
                'SELECT id, name, api_key, created_at FROM kiosks WHERE company_id = ?',
                req.user.companyId
            );
            res.json(kiosks);
        } catch (error) {
            res.status(500).json({ message: "Failed to retrieve kiosks." });
        }
    });

    app.get('/api/logs', authenticateToken, async (req, res) => {
        try {
            const logs = await db.all(
                `SELECT al.id, al.nfc_card_id, al.event_type, al.timestamp,
                        e.name AS employee_name
                 FROM attendance_logs al
                 LEFT JOIN employees e ON al.employee_id = e.id
                 WHERE al.company_id = ?
                 ORDER BY al.timestamp DESC`,
                req.user.companyId
            );
            res.json(logs);
        } catch (error) {
            res.status(500).json({ message: "Failed to retrieve logs." });
        }
    });

    app.get('/api/employees', authenticateToken, async (req, res) => {
        try {
            const employees = await db.all(
                'SELECT * FROM employees WHERE company_id =
