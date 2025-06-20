// database.js - The 100% correct and final version

async function setupDatabase(db) {
    console.log("--- Checking and creating tables with the LATEST schema ---");

    // This is the correct schema with all columns
    await db.run(`
        CREATE TABLE IF NOT EXISTS companies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            subscription_plan TEXT DEFAULT 'tier1',
            max_employees INTEGER DEFAULT 5,
            subscription_status TEXT DEFAULT 'active',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_id INTEGER NOT NULL,
            email TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (company_id) REFERENCES companies (id)
        )
    `);

    await db.run(`
        CREATE TABLE IF NOT EXISTS kiosks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            api_key TEXT NOT NULL UNIQUE,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (company_id) REFERENCES companies (id)
        )
    `);

    await db.run(`
        CREATE TABLE IF NOT EXISTS employees (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            nfc_card_id TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (company_id) REFERENCES companies (id),
            UNIQUE(company_id, nfc_card_id)
        )
    `);

    await db.run(`
        CREATE TABLE IF NOT EXISTS attendance_logs (
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
        )
    `);

    console.log("--- Database setup complete. All tables are ready. ---");
}

module.exports = { setupDatabase };