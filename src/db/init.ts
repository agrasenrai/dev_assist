import { initializeDatabase } from "./schema.js";
import { db } from "./connection.js";

try {
  initializeDatabase();
  console.log("Database initialized at:", process.env.SQLITE_DB_PATH || "./data/shiftweave.db");
} catch (error) {
  console.error("Failed to initialize database:", error);
  process.exit(1);
} finally {
  db.close();
}
