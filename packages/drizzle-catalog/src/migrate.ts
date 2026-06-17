import 'dotenv/config';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { migrate } from 'drizzle-orm/neon-http/migrator';

const sql = neon(process.env.CATALOG_DATABASE_URL!); // Use DIRECT (non-pooled) URL for migrations
const db = drizzle({ client: sql });

const main = async () => {
  console.log('Starting migrations...');
  try {
    await migrate(db, { migrationsFolder: './drizzle' }); // match your config
    console.log('✅ Migrations completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
};

await main();
