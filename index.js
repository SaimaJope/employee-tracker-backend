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
        console.error(`FATAL: DB connection error`, err);
        process.exit(1);
    });
    console.log(`Successfully connected to DB`);
    await setupDatabase(db);

    // --- MIDDLEWARE FUNCTIONS MOVED INSIDE startServer ---
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
    // --- END OF MIDDLEWARE ---


    // --- API ROUTES ---
    // (Register and Login are public)
    app.post('/api/auth/register', async (req, res) => {
        // ... your working registration logic ...
    });
    app.post('/api/auth/login', async (req, res) => {
        // ... your working login logic ...
    });

    // (Other routes are secured)
    app.get('/api/employees', authenticateToken, async (req, res) => {
        const employees = await db.all('SELECT * FROM employees WHERE company_id = ? ORDER BY name', req.user.companyId);
        res.json(employees);
    });

    app.post('/api/employees', authenticateToken, checkEmployeeLimit, async (req, res) => {
        // ... your working add employee logic ...
    });

    app.delete('/api/employees/:id', authenticateToken, async (req, res) => {
        // ... your working delete employee logic ...
    });

    // ... All other routes ...

    const port = process.env.PORT || 3001;
    app.listen(port, () => console.log(`Server started on port ${port}`));
}

startServer();