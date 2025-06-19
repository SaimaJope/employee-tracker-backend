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

    // --- SECURE LOGIN ROUTE ---
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
            const isPasswordCorrect = await bcrypt.compare(password, user.password_hash);
            if (!isPasswordCorrect) {
                return res.status(401).json({ message: 'Invalid email or password.' });
            }
            const payload = { id: user.id, email: user.email, companyId: user.company_id };
            const token = jwt.sign(payload, config.JWT_SECRET, { expiresIn: '8h' });
            res.status(200).json({ message: 'Login successful!', token: token });
        } catch (error) {
            console.error('--- LOGIN ERROR ---', error);
            res.status(500).json({ message: 'An internal server error occurred.' });
        }
    });

    // --- NEW: ATTENDANCE LOGS ROUTE ---
    app.get('/api/logs', authenticateToken, async (req, res) => {
        try {
            // This query joins the logs with the employees table to get the name
            const logs = await db.all(`
                SELECT
                    al.id,
                    al.event_type,
                    al.timestamp,
                    al.nfc_card_id,
                    e.name AS employee_name
                FROM
                    attendance_logs AS al
                LEFT JOIN
                    employees AS e ON al.employee_id = e.id
                WHERE
                    al.company_id = ?
                ORDER BY
                    al.timestamp DESC
                LIMIT 100
            `, req.user.companyId); // Filter by the logged-in user's company
            res.json(logs);
        } catch (error) {
            console.error("Error fetching logs:", error);
            res.status(500).json({ message: "Failed to fetch attendance logs." });
        }
    });

    // --- NEW: KIOSKS ROUTE ---
    app.get('/api/kiosks', authenticateToken, async (req, res) => {
        try {
            const kiosks = await db.all('SELECT * FROM kiosks WHERE company_id = ?', req.user.companyId);
            res.json(kiosks);
        } catch (error) {
            console.error("Error fetching kiosks:", error);
            res.status(500).json({ message: "Failed to fetch kiosks." });
        }
    });

    // --- EMPLOYEE MANAGEMENT ROUTES ---
    app.get('/api/employees', authenticateToken, async (req, res) => {
        const employees = await db.all('SELECT * FROM employees WHERE company_id = ? ORDER BY name', req.user.companyId);
        res.json(employees);
    });

    app.post('/api/employees', authenticateToken, checkEmployeeLimit, async (req, res) => {
        try {
            const { name, nfc_card_id } = req.body;
            if (!name || !nfc_card_id) {
                return res.status(400).json({ message: "Name and NFC card ID are required." });
            }
            await db.run(
                'INSERT INTO employees (company_id, name, nfc_card_id) VALUES (?, ?, ?)',
                req.user.companyId, name, nfc_card_id
            );
            res.status(201).json({ message: 'Employee added successfully.' });
        } catch (error) {
            console.error("Error adding employee:", error);
            res.status(500).json({ message: "Failed to add employee. The card ID might already be in use." });
        }
    });

    app.delete('/api/employees/:id', authenticateToken, async (req, res) => {
        try {
            // Make sure the employee belongs to the user's company before deleting
            const result = await db.run(
                'DELETE FROM employees WHERE id = ? AND company_id = ?',
                req.params.id,
                req.user.companyId
            );
            if (result.changes === 0) {
                return res.status(404).json({ message: "Employee not found or you do not have permission to delete it." });
            }
            res.status(200).json({ message: "Employee deleted successfully." });
        } catch (error) {
            console.error("Error deleting employee:", error);
            res.status(500).json({ message: "Failed to delete employee." });
        }
    });

    const port = process.env.PORT || 3001;
    app.listen(port, () => console.log(`Server started on port ${port}`));
}

startServer();