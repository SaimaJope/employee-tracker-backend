// index.js - The final, complete, and robust backend code with a transaction

const express = require('express');
const { open } = require('sqlite');
const sqlite3 = require('sqlite3');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { setupDatabase } = require('./database');

// ... (config, SUBSCRIPTION_PLANS, app setup are all correct) ...

const config = { JWT_SECRET: process.env.JWT_SECRET || 'your-default-dev-secret-key' };
const SUBSCRIPTION_PLANS = { 'tier1': { max_employees: 5 }, 'tier2': { max_employees: 10 }, 'tier3': { max_employees: 50 } };
const app = express();
app.use(cors());
app.use(express.json());
app.get('/', (req, res) => res.status(200).send({ status: 'ok' }));

const isProduction = process.env.NODE_ENV === 'production';
const dataDir = isProduction ? process.env.RENDER_DISK_PATH : __dirname;
const dbPath = path.join(dataDir, 'employee_tracker.db');

async function startServer() {
    const db = await open({
        filename: dbPath,
        driver: sqlite3.Database
    }).catch(err => { console.error(`FATAL: DB connection error`, err); process.exit(1); });

    // Enable WAL mode for better concurrency
    await db.run('PRAGMA journal_mode = WAL;');
    console.log(`Successfully connected to DB and enabled WAL mode.`);
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

    // --- API ROUTES ---

    // The login and registration routes are fine
    app.post('/api/auth/register', async (req, res) => { /* ... existing ... */ });
    app.post('/api/auth/login', async (req, res) => { /* ... existing ... */ });

    // --- THIS IS THE NEW, ATOMIC "ADD EMPLOYEE" ROUTE ---
    app.post('/api/employees', authenticateToken, async (req, res) => {
        const { name, nfc_card_id } = req.body;
        if (!name || !nfc_card_id) {
            return res.status(400).json({ message: "Name and NFC card ID are required." });
        }

        try {
            // This is the key: we start a transaction.
            // SERIALIZED makes sure that no other write operation can happen at the same time.
            await db.run('BEGIN IMMEDIATE TRANSACTION');

            // 1. Check the limit *inside* the transaction
            const company = await db.get('SELECT max_employees FROM companies WHERE id = ?', req.user.companyId);
            if (!company) {
                await db.run('ROLLBACK');
                return res.status(404).json({ message: "Company not found." });
            }

            const countResult = await db.get('SELECT COUNT(*) AS count FROM employees WHERE company_id = ?', req.user.companyId);
            if (countResult.count >= company.max_employees) {
                await db.run('ROLLBACK');
                return res.status(403).json({ message: `Employee limit of ${company.max_employees} reached.` });
            }

            // 2. Insert the new employee *inside* the transaction
            await db.run(
                'INSERT INTO employees (company_id, name, nfc_card_id) VALUES (?, ?, ?)',
                req.user.companyId, name, nfc_card_id
            );

            // 3. If everything worked, commit the changes.
            await db.run('COMMIT');

            return res.status(201).json({ message: 'Employee added successfully.' });
        } catch (error) {
            // If anything fails (like a duplicate card ID), roll back everything.
            await db.run('ROLLBACK');
            console.error("Transaction Error adding employee:", error);
            if (error.code === 'SQLITE_CONSTRAINT') {
                return res.status(409).json({ message: "Failed to add employee. That Card ID is already in use." });
            }
            return res.status(500).json({ message: "An internal server error occurred." });
        }
    });

    // Other routes
    app.get('/api/employees', authenticateToken, async (req, res) => { /* ... */ });
    app.delete('/api/employees/:id', authenticateToken, async (req, res) => { /* ... */ });

    const port = process.env.PORT || 10000;
    app.listen(port, () => console.log(`Server started on port ${port}`));
}

startServer();