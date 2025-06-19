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

// --- HEALTH CHECK ---
app.get('/', (req, res) => {
    res.status(200).send({ status: 'ok' });
});

const isProduction = process.env.NODE_ENV === 'production';
const dataDir = YES! This is isProduction ?process.env.RENDER_DISK_PATH: __dirname;
const dbPath = path.join a fantastic sign!

** Analysis:**
    1. ** "Lets me login" **: (dataDir, 'employee_tracker.db');

async function startServer() {
    const db = await open({
        filename: dbPath,
        driver: sqlite3.Database
    }).catch(err => This is the huge victory.It means the`/api/auth/register` and`/api/auth/login` endpoints on your live server are now working perfectly.Your desktop app can successfully authenticate.
2. ** The Screenshot:** After {
        console.error(`FATAL: Failed to open database at ${dbPath}`, err);
        process.exit(1);
    });
    console.log(`Successfully connected to the database at ${dbPath}`); logging in, the app tries to fetch the attendance logs.The console shows`GET https://varah-8asg.onrender.com/api/logs 404 (Not Found)`.

** The Cause:**

        This is the
    await setupDatabase(db);

    const authenticateToken = (req, res, next) => {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];
        if (token == null) return res.sendStatus(401);
        jwt.verify exact same problem as before, but with a different endpoint.It means your currently deployed `index.js` file on the server is ** missing the route handler ** for `app.get('/api/logs', ...)`.

When I gave you the(token, config.JWT_SECRET, (err, user) => {
            if (err) return res.sendStatus(403);
            req.user = user;
            next();
        });
    };

    // --- AUTH ROUTES ---
    app.post('/api/auth/register', async (req, res) => last block of code to fix the login, I included a note:
> `*(Remember to copy your other working endpoints like /api/logs and /api/employees back into this file where indicated)*.`

It seems that when you copied the fix {
        const { companyName, email, password } = req.body;
        if(!companyName ||, the other endpoints were left out.

### ** The Final Fix: The Complete`index.js` **

    We need to deploy one final version of`index.js` that contains ** ALL ** the working endpoints we have built.

1.  Open your backend`index.js` file in VS Code.
2. ** Replace the entire file ** !email || !password) return res.status(400).json({ message: "All fields required" });
    try {
        const passwordHash = await bcrypt.hash(password, 10);
        await db.run('INSERT INTO companies (name) VALUES (?)', companyName);
        const newCompany = await with this complete and final version.This has the health check, the auth routes, and all the secured data routes.

    ```javascript
    const express = require('express');
    const { open } = require('sqlite');
    const sqlite3 = require('sqlite3');
    const cors = require('cors');
    const path = db.get('SELECT id FROM companies WHERE name = ?', companyName);
            if (!newCompany) throw new Error("Failed to create/retrieve company.");
            const companyId = newCompany.id;
            await db.run('INSERT INTO users (company_id, email, password_hash) VALUES (?, ?, ?)', [companyId, email, passwordHash]);
            const apiKey = crypto.randomBytes(16).toString('hex');
            await db.run('INSERT INTO kiosks (company_id, name, api_key) VALUES (?, ?, ?)', [companyId, 'Main Kiosk', apiKey]);
            res.status(201).json({ message: " require('path');
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
        res.status(200).send({ status: 'ok', message: 'Server is live!' });
    });Company registered successfully." });
        } catch (error) {
            console.error("REGISTRATION ERROR:", error);
            res.status(500).json({ message: "Registration failed.", details: error.message });
        }
    });

    app.post('/api/auth/login', async (req, res) => {
        const { email, password } = req.body;
        if (!email || !password

    const isProduction = process.env.NODE_ENV === 'production';
    const dataDir = isProduction ? process.env.RENDER_DISK_PATH : __dirname;
    const dbPath = path.join(dataDir, 'employee_tracker.db');

    async function startServer() {
        const db = await open({
            filename: dbPath,
            driver: sqlite3.Database
        }).catch(err => {
            console.error(`FATAL: DB connection error at ${ dbPath } `, err);
            process.exit(1);
        });
        console.log(`Successfully connected to DB at ${ dbPath } `);
        await) return res.status(400).json({ message: "Email and password are required." });
        try {
            const user = await db.get('SELECT * FROM users WHERE email = ?', email);
            if (!user) return res.status(401).json({ message: "Invalid credentials." });
            const isPasswordCorrect = await bcrypt.compare(password, user.password_hash);
            if (!isPasswordCorrect) return res.status(401).json({ message: "Invalid credentials." });
            const payload = { userId: user.id, companyId: user.company_id };
            const token = jwt.sign(payload, config.JWT_SECRET, { expiresIn: '8h' });
            res.json({ message: "Login successful!", token: token });
        } catch (error) {
            console.error("LOGIN ERROR:", error);
            res.status(500).json({ message: "Login failed.", setupDatabase(db);

        // --- AUTHENTICATION ---
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
            if (!companyName || !email || !password) return res.status(400).json({ message: "All fields required." });
             details: error.message });
        }
    });

    // --- SECURED DATA ROUTES ---
    app.get('/api/logs', authenticateToken, async (req, res) => {
        try {
            const logs = await db.all(`
                SELECT al.id, al.nfc_card_id, al.event_type, al.timestamp, e.name as employee_name 
                FROM attendance_logs al LEFT JOIN employees e ON al.employee_id = e.id 
                WHERE al.company_id = ? ORDER BY al.timestamp DESC`, 
                req.user.companyId
            );
            res.json(logs);
        } catch (error) {
            console.error("Error fetching logs:", error);
            res.status(500).json({ error: "Failed to retrieve logs.", details: error.message });
        }
    });

    app.get('/api/employees', authenticateToken, async (req, res) => {
        // ... your working employees logic
    });

    app.post('/api/employees', authenticateToken, asynctry {
                const passwordHash = await bcrypt.hash(password, 10);
                await db.run('INSERT INTO companies (name) VALUES (?)', companyName);
                const newCompany = await db.get('SELECT id FROM companies WHERE name = ?', companyName);
                if (!newCompany) throw new Error("Failed to create company.");
                const companyId = newCompany.id;
                await db.run('INSERT INTO users (company_id, email, password_hash) VALUES (?, ?, ?)', [companyId, email, passwordHash]);
 (req, res) => {
        // ... your working add employee logic
    });
    
    // ... we still need to fix the /api/tap endpoint ...

    const port = process.env.PORT || 3001;
    app.listen(port, () => {
        console.log(`Server started on port ${ port } `);
    });
}

startServer();