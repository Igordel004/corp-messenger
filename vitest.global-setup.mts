import { Client } from 'pg';

const WORKING_DATABASE = /\/corp_messenger(?=[/?]|$)/;

const emptyTestDatabase = async (): Promise<void> => {
  const url = process.env['DATABASE_URL'];
  if (!url || WORKING_DATABASE.test(url)) {
    return;
  }

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'",
    );
    if (rows.length > 0) {
      const tables = rows.map((row) => `"${row.tablename}"`).join(', ');
      await client.query(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`);
    }
  } finally {
    await client.end();
  }
};

export const setup = emptyTestDatabase;
export const teardown = emptyTestDatabase;
