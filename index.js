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

// --- HEALTH CHECK ENDPOINT FOR RENDER ---
app.get('/', (req, res) => {
    res.status(200).send({ status: 'ok', message: 'Server is live and healthy!' });
});

const isProduction = process.env.NODE_ENV === 'production';
const dataDir = isProduction ? process.env.RENDER_DISK_PATH : __dirname;
const dbPath = path.join(dataDir, 'employee_tracker.db');

async function startServer() {
    const db = await open({
        filename: dbPath,
        driver: sqlite3.Database
    }).catch(err => {
        console.error(`FATAL: Failed to open database at ${dbPath}`, err);
        process.exit(1);
    });
    console.log(`Successfully connected to the database at ${dbPath}`);

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
        if (!companyName || !email || !password) return res.status(400).json({ message: "All fields are required." });
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
            console.error("REGISTRATION FAILED:", error);
            res.status(500).json({ message: "Registration failed.", details: error.message });
        }
    });

    // ... your other working endpoints (/login, /logs, /employees, /tap) go here ...

    const port = process.env.PORT || 3001;
    app.listen(port, () => {
        console.log(`Server started on port ${port}`);
    });
}

startServer();