import { drizzle } from "drizzle-orm/postgres-js";
import "dotenv/config";
import postgres from "postgres";
import { log } from "./vite";

// Check for database URL
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

// Create database connection
const connectionString = process.env.DATABASE_URL;
const client = postgres(connectionString);

log("Database connected", "database");

export const db = drizzle(client);
