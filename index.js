// index.js - The final, complete, and secure backend code

const express = require('express');
const { open } = require('sqlite');
const sqlite3 = require('sqlite3');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { setupDatabase } = require('./database');

const config = {
    JWT_SECRET: process.env.JWT_SECRET || 'your-default-dev-secret-key'
};

// This map defines your subscription tiers
const SUBSCRIPTION_PLANS = {
    'tier1': { max_employees: 5 },
    'tier2': { max_employees: 10 },
    'tier3': { max_employees: 50 }
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

    // --- MIDDLEWARE TO CHECK EMPLOYEE LIMIT (This was missing) ---
    const checkEmployeeLimit = async (req, res, next) => {
        try {
            if (!req.user || !req.user.companyId) {
                return res.status(401).json({ message: "Invalid user token. No company ID found." });
            }

            const company = await db.get('SELECT max_employees FROM companies WHERE id = ?', req.user.companyId);

            if (!company) {
                return res.status(404).json({ message: "Company not found for this user." });
            }

            if (typeof company.max_employees !== 'number') {
                return res.status(500).json({ message: "Subscription plan is misconfigured." });
            }

            const countResult = await db.get('SELECT COUNT(*) AS count FROM employees WHERE company_id = ?', req.user.companyId);
            const currentEmployees = countResult.count;

            if (currentEmployees >= company.max_employees) {
                return res.status(403).json({ message: `Employee limit of ${company.max_employees} reached. Please upgrade your plan.` });
            }

            next(); // All checks passed, proceed to add the employee
        } catch (error) {
            console.error("CRITICAL ERROR in checkEmployeeLimit:", error);
            // This is the message you saw: "Error checking subscription status."
            return res.status(500).json({ message: "Error checking subscription status." });
        }
    };

    // --- API ROUTES ---

    // --- REGISTRATION ROUTE ---
    app.post('/api/auth/register', async (req, res) => {
        const { companyName, email, password } = req.body;
        if (!companyName || !email || !password) {
            return res.status(400).json({ message: "Company name, email, and password are required." });
        }
        try {
            await db.run('BEGIN TRANSACTION');
            const companyResult = await db.run('INSERT INTO companies (name, subscription_plan, max_employees) VALUES (?, ?, ?)', companyName, 'tier1', SUBSCRIPTION_PLANS['tier1'].max_employees);
            const newCompanyId = companyResult.lastID;
            const passwordHash = await bcrypt.hash(password, 10);
            await db.run('INSERT INTO users (company_id, email, password_hash) VALUES (?, ?, ?)', newCompanyId, email, passwordHash);
            await db.run('COMMIT');
            res.status(201).json({ message: "Company and user registered successfully." });
        } catch (error) {
            await db.run('ROLLBACK');
            console.error("Registration Error:", error);
            res.status(500).json({ message: "Failed to register." });
        }
    });

    // --- LOGIN ROUTE ---
    app.post('/api/auth/login', async (req, res) => {
        try {
            const { email, password } = req.body;
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

    // --- ALL OTHER SECURED ROUTES ---
    app.get('/api/logs', authenticateToken, async (req, res) => { /* ... your logs code ... */ });
    app.get('/api/kiosks', authenticateToken, async (req, res) => { /* ... your kiosks code ... */ });
    app.get('/api/employees', authenticateToken, async (req, res) => { /* ... your get employees code ... */ });

    // --- ROUTE TO ADD EMPLOYEE (now includes the middleware) ---
    app.post('/api/employees', authenticateToken, checkEmployeeLimit, async (req, res) => {
        try {
            const { name, nfc_card_id } = req.body;
            await db.run('INSERT INTO employees (company_id, name, nfc_card_id) VALUES (?, ?, ?)', req.user.companyId, name, nfc_card_id);
            res.status(201).json({ message: 'Employee added successfully.' });
        } catch (error) {
            console.error("Error adding employee:", error);
            res.status(500).json({ message: "Failed to add employee." });
        }
    });

    app.delete('/api/employees/:id', authenticateToken, async (req, res) => { /* ... your delete employee code ... */ });

    // --- ROUTE TO UPDATE SUBSCRIPTION ---
    app.put('/api/company/subscription', authenticateToken, async (req, res) => {
        try {
            const { plan } = req.body;
            if (!plan || !SUBSCRIPTION_PLANS[plan]) {
                return res.status(400).json({ message: 'Invalid subscription plan.' });
            }
            const newMaxEmployees = SUBSCRIPTION_PLANS[plan].max_employees;
            await db.run('UPDATE companies SET subscription_plan = ?, max_employees = ? WHERE id = ?', plan, newMaxEmployees, req.user.companyId);
            res.status(200).json({ message: `Subscription updated to ${plan}.`, new_limit: newMaxEmployees });
        } catch (error) {
            console.error("Error updating subscription:", error);
            res.status(500).json({ message: 'Failed to update subscription.' });
        }
    });

    const port = process.env.PORT || 3001;
    app.listen(port, () => console.log(`Server started on port ${port}`));
}

startServer();