const sqlite3 = require('sqlite3').verbose();

// Connect to the SQLite database
const db = new sqlite3.Database('./database.db', (err) => {
    if (err) {
        console.error('Error opening database:', err);
    } else {
        console.log('Connected to the SQLite database.');
    }
});

// Function to add the memberSince column to the users table
function migrateDB() {
    db.serialize(() => {
        db.run('ALTER TABLE users ADD COLUMN memberSince TEXT', (err) => {
            if (err && !err.message.includes('duplicate column name')) {
                console.error('Error adding memberSince column:', err);
            } else {
                console.log('memberSince column added to users table.');
            }
        });
    });
}

// Run the migration
migrateDB();

// Close the database connection
db.close((err) => {
    if (err) {
        console.error('Error closing database:', err);
    } else {
        console.log('Database connection closed.');
    }
});
