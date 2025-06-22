// database.js - The final, safe, and correct version with all migrations

// A helper function to check if a column exists in a table
async function columnExists(db, tableName, columnName) {
    const columns = await db.all(`PRAGMA table_info(${tableName})`);
    return columns.some(column => column.name === columnName);
}

async function setupDatabase(db) {
    console.log("--- Starting database setup and migration check ---");

    // Create the 'companies' table if it doesn't exist
    await db.run(`
        CREATE TABLE IF NOT EXISTS companies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // --- THE SAFE MIGRATION LOGIC ---
    if (!(await columnExists(db, 'companies', 'subscription_plan'))) {
        console.log("!!! MIGRATION: 'subscription_plan' column not found. Adding it now...");
        await db.run("ALTER TABLE companies ADD COLUMN subscription_plan TEXT DEFAULT 'free'");
    }

    if (!(await columnExists(db, 'companies', 'max_employees'))) {
        console.log("!!! MIGRATION: 'max_employees' column not found. Adding it now...");
        await db.run("ALTER TABLE companies ADD COLUMN max_employees INTEGER DEFAULT 5");
    }

    if (!(await columnExists(db, 'companies', 'subscription_status'))) {
        console.log("!!! MIGRATION: 'subscription_status' column not found. Adding it now...");
        await db.run("ALTER TABLE companies ADD COLUMN subscription_status TEXT DEFAULT 'active'");
    }

    // --- NEW MIGRATION FOR STRIPE ---
    if (!(await columnExists(db, 'companies', 'stripe_customer_id'))) {
        console.log("!!! MIGRATION: 'stripe_customer_id' column not found. Adding it now...");
        await db.run("ALTER TABLE companies ADD COLUMN stripe_customer_id TEXT");
    }

    // Now, ensure all other tables exist
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

    console.log("--- Database setup and migration check complete. ---");
}

module.exports = { setupDatabase };