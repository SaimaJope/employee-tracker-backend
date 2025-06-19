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

    // --- MIDDLEWARE FUNCTIONS ---
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

    // --- API ROUTES ---

    // Registration route would go here...
    app.post('/api/auth/register', async (req, res) => {
        // ... assuming you have registration logic here ...
        res.status(501).send({ message: "Registration not implemented in this snippet." });
    });

    // =========================================================================
    // === TEMPORARY, INSECURE LOGIN ROUTE FOR TESTING PERFORMANCE ===
    // This code SKIPS the password check to see if bcrypt is the bottleneck.
    // DO NOT USE THIS IN PRODUCTION.
    // =========================================================================
    app.post('/api/auth/login', async (req, res) => {
        try {
            const { email, password } = req.body;
            if (!email || !password) {
                return res.status(400).json({ message: 'Email and password are required.' });
            }

            const user = await db.get('SELECT * FROM users WHERE email = ?', email);
            if (!user) {
                return res.status(401).json({ message: 'Invalid email or password.' });
            }

            // --- PASSWORD CHECK IS DISABLED FOR THIS TEST ---
            console.log(`--- SKIPPING PASSWORD CHECK FOR: ${email} (TESTING ONLY) ---`);

            const payload = {
                id: user.id,
                email: user.email,
                companyId: user.company_id
            };

            const token = jwt.sign(payload, config.JWT_SECRET, { expiresIn: '8h' });

            console.log(`Successful test login for user: ${email}`);
            return res.status(200).json({
                message: 'Login successful!',
                token: token
            });

        } catch (error) {
            console.error('--- LOGIN ERROR ---', error);
            return res.status(500).json({ message: 'An internal server error occurred.' });
        }
    });


    // (Other secured routes)
    app.get('/api/employees', authenticateToken, async (req, res) => {
        const employees = await db.all('SELECT * FROM employees WHERE company_id = ? ORDER BY name', req.user.companyId);
        res.json(employees);
    });

    app.post('/api/employees', authenticateToken, checkEmployeeLimit, async (req, res) => {
        // ... your working add employee logic ...
        res.status(501).send({ message: "Not implemented in this snippet." });
    });

    app.delete('/api/employees/:id', authenticateToken, async (req, res) => {
        // ... your working delete employee logic ...
        res.status(501).send({ message: "Not implemented in this snippet." });
    });

    const port = process.env.PORT || 3001;
    app.listen(port, () => console.log(`Server started on port ${port}`));
}

startServer();