const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt'); // We'll use this for password hashing

const db = new sqlite3.Database('./employee_tracker.db', (err) => {
    if (err) {
        return console.error("Error opening database:", err.message);
    }
    console.log('Successfully connected to multi-tenant employee_tracker.db.');
});

db.serialize(() => {
    console.log('--- Starting multi-tenant table creation ---');

    // 1. Companies Table
    db.run(`CREATE TABLE IF NOT EXISTS companies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        subscription_status TEXT DEFAULT 'active',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, (err) => {
        if (err) return console.error("Error creating 'companies' table:", err.message);
        console.log("=> 'companies' table created or already exists.");
    });

    // 2. Users Table (for manager logins)
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (company_id) REFERENCES companies (id)
    )`, (err) => {
        if (err) return console.error("Error creating 'users' table:", err.message);
        console.log("=> 'users' table created or already exists.");
    });

    // 3. Kiosks Table (for the Android tablets)
    db.run(`CREATE TABLE IF NOT EXISTS kiosks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        api_key TEXT NOT NULL UNIQUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (company_id) REFERENCES companies (id)
    )`, (err) => {
        if (err) return console.error("Error creating 'kiosks' table:", err.message);
        console.log("=> 'kiosks' table created or already exists.");
    });

    // 4. Employees Table (now linked to a company)
    db.run(`CREATE TABLE IF NOT EXISTS employees (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        nfc_card_id TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (company_id) REFERENCES companies (id),
        UNIQUE(company_id, nfc_card_id)
    )`, (err) => {
        if (err) return console.error("Error creating 'employees' table:", err.message);
        console.log("=> 'employees' table updated and created.");
    });

    // 5. Attendance Logs Table (also linked to company and kiosk)
    db.run(`CREATE TABLE IF NOT EXISTS attendance_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        employee_id INTEGER NOT NULL,
        kiosk_id INTEGER,
        nfc_card_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (company_id) REFERENCES companies (id),
        FOREIGN KEY (employee_id) REFERENCES employees (id),
        FOREIGN KEY (kiosk_id) REFERENCES kiosks (id)
    )`, (err) => {
        if (err) return console.error("Error creating 'attendance_logs' table:", err.message);
        console.log("=> 'attendance_logs' table updated and created.");
    });

    console.log('--- Finished multi-tenant table creation ---');
});

db.close((err) => {
    if (err) return console.error(err.message);
    console.log('Database connection closed.');
});