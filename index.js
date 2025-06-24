// index.js - The final, single, complete backend file with Stripe integration

require('dotenv').config();
const express = require('express');
const http = require('http'); // ADDED
const { Server } = require("socket.io"); // ADDED
const { open } = require('sqlite');
const sqlite3 = require('sqlite3');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { setupDatabase } = require('./database');

// --- ADDED: Environment Variable Check ---
const requiredEnvVars = [
    'JWT_SECRET',
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'STRIPE_SUCCESS_URL',
    'STRIPE_CANCEL_URL'
];

for (const varName of requiredEnvVars) {
    if (!process.env[varName]) {
        console.error(`FATAL ERROR: Environment variable ${varName} is not set.`);
        process.exit(1); // Exit the application if a required variable is missing
    }
}
// --- END OF ADDED CHECK ---

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// --- CONFIGURATION ---
const config = {
    JWT_SECRET: process.env.JWT_SECRET,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    SUCCESS_URL: process.env.STRIPE_SUCCESS_URL,
    CANCEL_URL: process.env.STRIPE_CANCEL_URL
};

// --- SUBSCRIPTION PLANS ---
const SUBSCRIPTION_PLANS = {
    'free': { name: 'Free', max_employees: 5, price: 0, priceId: null },
    'tier1': { name: 'Starter', max_employees: 25, price: 10, priceId: 'price_1RcqdMRrM3oPkiXETF1HGOgU' },
    'tier2': { name: 'Business', max_employees: 100, price: 25, priceId: 'price_1RcqdzRrM3oPkiXEWrBjpEXK' },
    'tier3': { name: 'Enterprise', max_employees: 500, price: 50, priceId: 'price_1RcqeLRrM3oPkiXEvjDqtRT8' }
};

// --- APP SETUP ---
const app = express();
// --- ADDED: Create HTTP server and Socket.IO server ---
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: "*", // Allows all origins, fine for this project
        methods: ["GET", "POST"]
    }
});
// --------------------------------------------------------

app.use(cors());
app.use((req, res, next) => {
    if (req.originalUrl === '/api/subscription/webhook') {
        express.raw({ type: 'application/json' })(req, res, next);
    } else {
        express.json()(req, res, next);
    }
});
app.get('/', (req, res) => res.status(200).send({ status: 'ok' }));

// --- DATABASE PATH ---
const isProduction = process.env.NODE_ENV === 'production';
const dataDir = isProduction ? process.env.RENDER_DISK_PATH : __dirname;
const dbPath = path.join(dataDir, 'employee_tracker.db');

// --- DATABASE HELPER ---
const updateCompanySubscription = async (db, customerId, newPlanKey, status = 'active') => {
    const planDetails = SUBSCRIPTION_PLANS[newPlanKey];
    if (planDetails) {
        await db.run(
            "UPDATE companies SET subscription_plan = ?, max_employees = ?, subscription_status = ? WHERE stripe_customer_id = ?",
            newPlanKey, planDetails.max_employees, status, customerId
        );
        console.log(`Updated customer ${customerId} to plan ${newPlanKey} with status ${status}.`);
    } else {
        console.error(`Attempted to update to an unknown plan key: ${newPlanKey}`);
    }
};

// --- MAIN SERVER FUNCTION ---
async function startServer() {
    const db = await open({ filename: dbPath, driver: sqlite3.Database });
    await db.run('PRAGMA journal_mode = WAL;');
    await setupDatabase(db);
    console.log("Database connection established and migrations checked.");

    // --- MIDDLEWARE ---
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

    const authenticateKiosk = async (req, res, next) => {
        const apiKey = req.headers['x-api-key'];
        if (!apiKey) return res.status(401).json({ success: false, message: 'API Key is missing.' });
        try {
            const kiosk = await db.get('SELECT id, company_id FROM kiosks WHERE api_key = ?', apiKey);
            if (!kiosk) return res.status(403).json({ success: false, message: 'Invalid API Key.' });
            req.kiosk = kiosk;
            next();
        } catch (error) {
            res.status(500).json({ success: false, message: 'Server error during authentication.' });
        }
    };

    const checkEmployeeLimit = async (req, res, next) => {
        try {
            const company = await db.get('SELECT max_employees, subscription_status FROM companies WHERE id = ?', req.user.companyId);
            if (!company) {
                return res.status(403).json({ message: "Company not found." });
            }
            if (company.subscription_status !== 'active') {
                return res.status(403).json({ message: "Your subscription is not active. Please check your billing." });
            }
            const countResult = await db.get('SELECT COUNT(*) AS count FROM employees WHERE company_id = ?', req.user.companyId);
            if (countResult.count >= company.max_employees) {
                return res.status(403).json({ message: `Employee limit of ${company.max_employees} reached. Please upgrade your plan.` });
            }
            next();
        } catch (error) {
            res.status(500).json({ message: 'Error checking subscription.' });
        }
    };

    // --- API ROUTES ---

    // AUTH ROUTES
    app.post('/api/auth/register', async (req, res) => {
        const { companyName, email, password } = req.body;
        if (!companyName || !email || !password) return res.status(400).json({ message: "All fields are required." });
        try {
            await db.run('BEGIN TRANSACTION');
            const freePlan = SUBSCRIPTION_PLANS['free'];
            const companyResult = await db.run('INSERT INTO companies (name, subscription_plan, max_employees) VALUES (?, ?, ?)', companyName, 'free', freePlan.max_employees);
            const newCompanyId = companyResult.lastID;
            const passwordHash = await bcrypt.hash(password, 10);
            await db.run('INSERT INTO users (company_id, email, password_hash) VALUES (?, ?, ?)', newCompanyId, email, passwordHash);
            const apiKey = crypto.randomBytes(16).toString('hex');
            await db.run('INSERT INTO kiosks (company_id, name, api_key) VALUES (?, ?, ?)', newCompanyId, 'Main Kiosk', apiKey);
            await db.run('COMMIT');
            res.status(201).json({ message: "Company registered successfully." });
        } catch (error) {
            await db.run('ROLLBACK');
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
            res.status(500).json({ message: 'An internal server error occurred.' });
        }
    });

    // EMPLOYEE ROUTES
    app.get('/api/employees', authenticateToken, async (req, res) => {
        try {
            const employees = await db.all('SELECT * FROM employees WHERE company_id = ? ORDER BY name', req.user.companyId);
            res.status(200).json(employees);
        } catch (error) {
            res.status(500).json({ message: "Failed to fetch employee list." });
        }
    });

    app.post('/api/employees', authenticateToken, checkEmployeeLimit, async (req, res) => {
        const { name, nfc_card_id } = req.body;
        if (!name || !nfc_card_id) return res.status(400).json({ message: "Name and NFC card ID are required." });
        try {
            await db.run('INSERT INTO employees (company_id, name, nfc_card_id) VALUES (?, ?, ?)', req.user.companyId, name, nfc_card_id);
            res.status(201).json({ message: 'Employee added successfully.' });
        } catch (error) {
            if (error.code === 'SQLITE_CONSTRAINT') return res.status(409).json({ message: "Failed to add employee. That Card ID is already in use." });
            res.status(500).json({ message: "A server error occurred while adding the employee." });
        }
    });

    app.delete('/api/employees/:id', authenticateToken, async (req, res) => {
        try {
            await db.run('DELETE FROM employees WHERE id = ? AND company_id = ?', req.params.id, req.user.companyId);
            res.status(200).json({ message: "Employee successfully removed." });
        } catch (error) {
            res.status(500).json({ message: "Failed to delete employee." });
        }
    });

    // KIOSK ROUTES
    app.post('/api/kiosk/tap', authenticateKiosk, async (req, res) => {
        const { nfc_card_id } = req.body;
        if (!nfc_card_id) return res.status(400).json({ success: false, message: "NFC Card ID is required." });
        const { company_id, id: kiosk_id } = req.kiosk;
        try {
            const employee = await db.get('SELECT id, name FROM employees WHERE company_id = ? AND nfc_card_id = ?', company_id, nfc_card_id);
            if (!employee) return res.status(404).json({ success: false, message: `Card not recognized.` });
            const lastLog = await db.get('SELECT event_type FROM attendance_logs WHERE employee_id = ? ORDER BY timestamp DESC LIMIT 1', employee.id);
            const newEventType = (!lastLog || lastLog.event_type === 'clock-out') ? 'clock-in' : 'clock-out';

            await db.run('INSERT INTO attendance_logs (company_id, employee_id, kiosk_id, nfc_card_id, event_type) VALUES (?, ?, ?, ?, ?)', company_id, employee.id, kiosk_id, nfc_card_id, newEventType);

            // --- THIS IS THE MAGIC PART ---
            // After successfully saving the log, emit an event to all connected clients
            io.emit('new_log_entry');
            console.log('Emitted "new_log_entry" event to all connected clients.');
            // -----------------------------

            const actionMessage = newEventType === 'clock-in' ? 'Clocked In' : 'Clocked Out';
            res.status(200).json({ success: true, message: `${employee.name}\n${actionMessage}`, employee_name: employee.name, action: newEventType });
        } catch (error) {
            res.status(500).json({ success: false, message: "Server error. Please try again." });
        }
    });

    app.get('/api/kiosks', authenticateToken, async (req, res) => {
        try {
            const kiosks = await db.all('SELECT id, name, api_key, created_at FROM kiosks WHERE company_id = ?', req.user.companyId);
            res.status(200).json(kiosks);
        } catch (error) {
            res.status(500).json({ message: "Failed to fetch kiosk list." });
        }
    });

    // LOGS ROUTE
    app.get('/api/logs', authenticateToken, async (req, res) => {
        try {
            const logs = await db.all(`
                SELECT al.id, al.event_type, al.timestamp, al.nfc_card_id, e.name as employee_name, k.name as kiosk_name
                FROM attendance_logs al
                JOIN employees e ON al.employee_id = e.id
                LEFT JOIN kiosks k ON al.kiosk_id = k.id
                WHERE al.company_id = ? ORDER BY al.timestamp DESC LIMIT 100`, req.user.companyId);
            res.json(logs);
        } catch (error) {
            res.status(500).json({ message: "Failed to fetch attendance logs." });
        }
    });

    // SUBSCRIPTION ROUTES
    app.get('/api/subscription/status', authenticateToken, async (req, res) => {
        try {
            const company = await db.get('SELECT subscription_plan, max_employees FROM companies WHERE id = ?', req.user.companyId);
            const { count } = await db.get('SELECT COUNT(*) AS count FROM employees WHERE company_id = ?', req.user.companyId);
            res.json({
                plan: company.subscription_plan,
                employeeCount: count,
                maxEmployees: company.max_employees
            });
        } catch (error) {
            res.status(500).json({ message: "Failed to get subscription status." });
        }
    });

    app.post('/api/subscription/create-checkout-session', authenticateToken, async (req, res) => {
        const { priceId } = req.body;
        const { companyId, email } = req.user;

        try {
            let company = await db.get('SELECT stripe_customer_id FROM companies WHERE id = ?', companyId);
            let customerId = company.stripe_customer_id;

            if (!customerId) {
                const customer = await stripe.customers.create({
                    email: email,
                    metadata: { companyId: companyId }
                });
                customerId = customer.id;
                await db.run('UPDATE companies SET stripe_customer_id = ? WHERE id = ?', customerId, companyId);
            }

            const session = await stripe.checkout.sessions.create({
                customer: customerId,
                payment_method_types: ['card'],
                line_items: [{ price: priceId, quantity: 1 }],
                mode: 'subscription',
                allow_promotion_codes: true,
                success_url: config.SUCCESS_URL,
                cancel_url: config.CANCEL_URL,
                metadata: {
                    companyId: companyId
                }
            });
            res.json({ id: session.id });
        } catch (error) {
            console.error("Stripe session creation failed:", error);
            res.status(500).json({ message: "Failed to create Stripe session." });
        }
    });

    app.post('/api/subscription/webhook', async (req, res) => {
        const sig = req.headers['stripe-signature'];
        let event;

        try {
            event = stripe.webhooks.constructEvent(req.body, sig, config.STRIPE_WEBHOOK_SECRET);
        } catch (err) {
            console.error(`Webhook Error: ${err.message}`);
            return res.status(400).send(`Webhook Error: ${err.message}`);
        }

        const session = event.data.object;
        const customerId = session.customer;

        try {
            if (event.type === 'checkout.session.completed' && session.mode === 'subscription') {
                const subscription = await stripe.subscriptions.retrieve(session.subscription);
                const priceId = subscription.items.data[0].price.id;
                const [planKey] = Object.entries(SUBSCRIPTION_PLANS).find(([, details]) => details.priceId === priceId) || [];

                if (planKey) {
                    await updateCompanySubscription(db, customerId, planKey, 'active');
                }
            } else if (event.type === 'customer.subscription.updated') {
                const priceId = session.items.data[0].price.id;
                const [planKey] = Object.entries(SUBSCRIPTION_PLANS).find(([, details]) => details.priceId === priceId) || [];

                if (planKey) {
                    await updateCompanySubscription(db, customerId, planKey, session.status);
                }
            } else if (event.type === 'customer.subscription.deleted') {
                await updateCompanySubscription(db, customerId, 'free', 'canceled');
            }
        } catch (dbError) {
            console.error("Database update failed after webhook:", dbError);
        }

        res.json({ received: true });
    });

    // --- START SERVER ---
    // --- MODIFIED: Listen on httpServer instead of app ---
    const port = process.env.PORT || 10000;
    httpServer.listen(port, () => console.log(`Server started on port ${port}`));
    // -----------------------------------------------------
}

startServer();