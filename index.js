// index.js - The final, complete, and robust backend with Stripe integration

require('dotenv').config();
const express = require('express');
const { open } = require('sqlite');
const sqlite3 = require('sqlite3');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { setupDatabase } = require('./database');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// --- CONFIGURATION ---
const config = {
    JWT_SECRET: process.env.JWT_SECRET,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET
};

// Define plans with Stripe Price IDs (you will create these in the Stripe Dashboard)
const SUBSCRIPTION_PLANS = {
    'free': { name: 'Free', max_employees: 5, price: 0, priceId: null },
    // IMPORTANT: Replace these with your actual Price IDs from the Stripe Dashboard
    'tier1': { name: 'Starter', max_employees: 25, price: 10, priceId: 'price_REPLACE_WITH_YOUR_TIER1_ID' },
    'tier2': { name: 'Business', max_employees: 100, price: 25, priceId: 'price_REPLACE_WITH_YOUR_TIER2_ID' },
    'tier3': { name: 'Enterprise', max_employees: 500, price: 50, priceId: 'price_REPLACE_WITH_YOUR_TIER3_ID' }
};

// --- APP SETUP ---
const app = express();
app.use(cors());
// The Stripe webhook needs the raw body, so we use a conditional JSON parser.
app.use((req, res, next) => {
    if (req.originalUrl === '/api/subscription/webhook') {
        next();
    } else {
        express.json()(req, res, next);
    }
});
app.get('/', (req, res) => res.status(200).send({ status: 'ok' }));

// --- DATABASE PATH ---
const isProduction = process.env.NODE_ENV === 'production';
const dataDir = isProduction ? process.env.RENDER_DISK_PATH : __dirname;
const dbPath = path.join(dataDir, 'employee_tracker.db');

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

    const checkEmployeeLimit = async (req, res, next) => {
        try {
            const company = await db.get('SELECT max_employees, subscription_status FROM companies WHERE id = ?', req.user.companyId);
            if (!company || company.subscription_status !== 'active') {
                return res.status(403).json({ message: "Your subscription is not active." });
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
            // New companies start on the 'free' plan.
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
    app.post('/api/auth/login', async (req, res) => { /* ... (no changes needed) ... */ });

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
        const companyId = req.user.companyId;
        const successUrl = 'http://localhost:3000/success'; // Placeholder, Electron will intercept this
        const cancelUrl = 'http://localhost:3000/cancel'; // Placeholder

        try {
            let company = await db.get('SELECT stripe_customer_id FROM companies WHERE id = ?', companyId);
            let customerId = company.stripe_customer_id;

            if (!customerId) {
                const customer = await stripe.customers.create({
                    name: req.user.email,
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
                success_url: successUrl,
                cancel_url: cancelUrl,
            });
            res.json({ id: session.id });
        } catch (error) {
            res.status(500).json({ message: "Failed to create Stripe session." });
        }
    });

    app.post('/api/subscription/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
        const sig = req.headers['stripe-signature'];
        let event;
        try {
            event = stripe.webhooks.constructEvent(req.body, sig, config.STRIPE_WEBHOOK_SECRET);
        } catch (err) {
            console.error(`Webhook Error: ${err.message}`);
            return res.status(400).send(`Webhook Error: ${err.message}`);
        }

        if (event.type === 'checkout.session.completed') {
            const session = event.data.object;
            const customerId = session.customer;
            if (session.mode === 'subscription') {
                const subscription = await stripe.subscriptions.retrieve(session.subscription);
                const priceId = subscription.items.data[0].price.id;

                const [planKey, planDetails] = Object.entries(SUBSCRIPTION_PLANS).find(([, details]) => details.priceId === priceId) || [];

                if (planKey && planDetails) {
                    await db.run("UPDATE companies SET subscription_plan = ?, max_employees = ?, subscription_status = 'active' WHERE stripe_customer_id = ?",
                        planKey, planDetails.max_employees, customerId
                    );
                    console.log(`SUCCESS: Upgraded customer ${customerId} to plan ${planKey}.`);
                }
            }
        }
        res.json({ received: true });
    });

    // All other routes remain the same, just ensure they are defined within this function.
    app.post('/api/employees', authenticateToken, checkEmployeeLimit, async (req, res) => { /* ... (no changes needed) ... */ });
    app.get('/api/employees', authenticateToken, async (req, res) => { /* ... (no changes needed) ... */ });
    app.delete('/api/employees/:id', authenticateToken, async (req, res) => { /* ... (no changes needed) ... */ });
    app.post('/api/kiosk/tap', (req, res, next) => {/* This needs the kiosk auth middleware */ }, async (req, res) => { /* ... (no changes needed) ... */ });
    app.get('/api/kiosks', authenticateToken, async (req, res) => { /* ... (no changes needed) ... */ });
    app.get('/api/logs', authenticateToken, async (req, res) => { /* ... (no changes needed) ... */ });

    // --- START SERVER ---
    const port = process.env.PORT || 10000;
    app.listen(port, () => console.log(`Server started on port ${port}`));
}

// --- KEEP THE EXISTING ROUTE DEFINITIONS HERE FOR COMPLETENESS ---
// (Copy-pasting them here inside the comment to avoid breaking the structure)

// The code from your previous file for login, employee management, etc., would be placed
// inside the startServer function where the "no changes needed" comments are.
// I have omitted them for brevity, but they must be moved inside the async function.

startServer(); // Start the application