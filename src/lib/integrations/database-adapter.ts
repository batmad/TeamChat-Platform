import "server-only";
import { Client as PgClient } from "pg";
import mysql, { type Connection as MySqlConnection } from "mysql2/promise";
import { AppError } from "@/lib/api/app-error";
import { databaseConfigSchema, databaseSecretSchema } from "@/lib/integrations/schemas";
import type { DatabaseIntegrationConfig, DatabaseIntegrationSecret, SourceField, SourceTable } from "@/lib/integrations/types";

export type SupportedDatabaseType = "POSTGRESQL" | "MYSQL" | "MARIADB" | "SQLSERVER";

function assertIdentifier(value: string, label: string): string {
  if (!/^[A-Za-z0-9_$.-]+$/.test(value)) {
    throw new AppError(400, "INVALID_SOURCE_IDENTIFIER", `${label} contains unsupported characters`);
  }
  return value;
}

function pgIdentifier(value: string): string {
  return `"${assertIdentifier(value, "Identifier").replaceAll('"', '""')}"`;
}

function mysqlIdentifier(value: string): string {
  return `\`${assertIdentifier(value, "Identifier").replaceAll("`", "``")}\``;
}

function normalizeDbConfig(config: unknown): DatabaseIntegrationConfig {
  return databaseConfigSchema.parse(config);
}

function normalizeDbSecret(secret: unknown): DatabaseIntegrationSecret {
  return databaseSecretSchema.parse(secret ?? { password: "" });
}

function mysqlConnectionOptions(config: DatabaseIntegrationConfig, secret: DatabaseIntegrationSecret, timeoutMs: number) {
  return {
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.username,
    password: secret.password,
    connectTimeout: timeoutMs,
    ssl: config.sslMode === "REQUIRE" ? {} : undefined,
  };
}

async function withMysqlConnection<T>(
  config: DatabaseIntegrationConfig,
  secret: DatabaseIntegrationSecret,
  timeoutMs: number,
  action: (connection: MySqlConnection) => Promise<T>,
): Promise<T> {
  const connection = await mysql.createConnection(mysqlConnectionOptions(config, secret, timeoutMs));
  try {
    return await action(connection);
  } finally {
    await connection.end();
  }
}

async function withPostgresClient<T>(
  config: DatabaseIntegrationConfig,
  secret: DatabaseIntegrationSecret,
  timeoutMs: number,
  action: (client: PgClient) => Promise<T>,
): Promise<T> {
  const client = new PgClient({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.username,
    password: secret.password,
    connectionTimeoutMillis: timeoutMs,
    query_timeout: timeoutMs,
    statement_timeout: timeoutMs,
    ssl: config.sslMode === "REQUIRE" ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();
  try {
    return await action(client);
  } finally {
    await client.end();
  }
}

function sqlServerUnavailable(): never {
  throw new AppError(
    501,
    "SQLSERVER_DRIVER_UNAVAILABLE",
    "SQL Server integration is reserved in the schema but the runtime driver is not enabled in this build",
  );
}

function tableReference(databaseType: SupportedDatabaseType, config: DatabaseIntegrationConfig, table: string): string {
  assertIdentifier(table, "Table name");
  if (databaseType === "POSTGRESQL") {
    const schema = config.schema?.trim() || "public";
    return `${pgIdentifier(schema)}.${pgIdentifier(table)}`;
  }
  if (databaseType === "MYSQL" || databaseType === "MARIADB") {
    return `${mysqlIdentifier(config.database)}.${mysqlIdentifier(table)}`;
  }
  return sqlServerUnavailable();
}

export async function testDatabaseConnection(
  databaseType: SupportedDatabaseType,
  rawConfig: unknown,
  rawSecret: unknown,
  timeoutMs: number,
): Promise<void> {
  const config = normalizeDbConfig(rawConfig);
  const secret = normalizeDbSecret(rawSecret);

  if (databaseType === "POSTGRESQL") {
    await withPostgresClient(config, secret, timeoutMs, async (client) => {
      await client.query("SELECT 1 AS ok");
    });
    return;
  }

  if (databaseType === "MYSQL" || databaseType === "MARIADB") {
    await withMysqlConnection(config, secret, timeoutMs, async (connection) => {
      await connection.query("SELECT 1 AS ok");
    });
    return;
  }

  sqlServerUnavailable();
}

export async function listDatabaseTables(
  databaseType: SupportedDatabaseType,
  rawConfig: unknown,
  rawSecret: unknown,
  timeoutMs: number,
): Promise<SourceTable[]> {
  const config = normalizeDbConfig(rawConfig);
  const secret = normalizeDbSecret(rawSecret);

  if (databaseType === "POSTGRESQL") {
    return withPostgresClient(config, secret, timeoutMs, async (client) => {
      const params: unknown[] = [];
      const schemaFilter = config.schema?.trim();
      let query = `SELECT table_schema, table_name FROM information_schema.tables WHERE table_type = 'BASE TABLE' AND table_schema NOT IN ('pg_catalog', 'information_schema')`;
      if (schemaFilter) {
        params.push(schemaFilter);
        query += ` AND table_schema = $1`;
      }
      query += " ORDER BY table_schema, table_name";
      const result = await client.query(query, params);
      return result.rows.map((row) => ({ schema: String(row.table_schema), name: String(row.table_name) }));
    });
  }

  if (databaseType === "MYSQL" || databaseType === "MARIADB") {
    return withMysqlConnection(config, secret, timeoutMs, async (connection) => {
      const [rows] = await connection.query(
        "SELECT table_schema, table_name FROM information_schema.tables WHERE table_type = 'BASE TABLE' AND table_schema = ? ORDER BY table_name",
        [config.database],
      );
      return (rows as Record<string, unknown>[]).map((row) => ({
        schema: String(row.TABLE_SCHEMA ?? row.table_schema ?? config.database),
        name: String(row.TABLE_NAME ?? row.table_name),
      }));
    });
  }

  return sqlServerUnavailable();
}

export async function listDatabaseFields(
  databaseType: SupportedDatabaseType,
  rawConfig: unknown,
  rawSecret: unknown,
  timeoutMs: number,
  table: string,
): Promise<SourceField[]> {
  const config = normalizeDbConfig(rawConfig);
  const secret = normalizeDbSecret(rawSecret);
  assertIdentifier(table, "Table name");

  if (databaseType === "POSTGRESQL") {
    return withPostgresClient(config, secret, timeoutMs, async (client) => {
      const schema = config.schema?.trim() || "public";
      const result = await client.query(
        `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position`,
        [schema, table],
      );
      return result.rows.map((row) => ({
        name: String(row.column_name),
        type: String(row.data_type),
        nullable: String(row.is_nullable).toUpperCase() === "YES",
      }));
    });
  }

  if (databaseType === "MYSQL" || databaseType === "MARIADB") {
    return withMysqlConnection(config, secret, timeoutMs, async (connection) => {
      const [rows] = await connection.query(
        `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema = ? AND table_name = ? ORDER BY ordinal_position`,
        [config.database, table],
      );
      return (rows as Record<string, unknown>[]).map((row) => ({
        name: String(row.COLUMN_NAME ?? row.column_name),
        type: String(row.DATA_TYPE ?? row.data_type),
        nullable: String(row.IS_NULLABLE ?? row.is_nullable).toUpperCase() === "YES",
      }));
    });
  }

  return sqlServerUnavailable();
}

export async function previewDatabaseRows(
  databaseType: SupportedDatabaseType,
  rawConfig: unknown,
  rawSecret: unknown,
  timeoutMs: number,
  limit: number,
): Promise<Record<string, unknown>[]> {
  const config = normalizeDbConfig(rawConfig);
  const secret = normalizeDbSecret(rawSecret);
  if (!config.userTable) throw new AppError(400, "USER_TABLE_REQUIRED", "Select and save a user table first");
  const safeLimit = Math.max(1, Math.min(limit, 20));
  const table = tableReference(databaseType, config, config.userTable);

  if (databaseType === "POSTGRESQL") {
    return withPostgresClient(config, secret, timeoutMs, async (client) => {
      const result = await client.query(`SELECT * FROM ${table} LIMIT $1`, [safeLimit]);
      return result.rows as Record<string, unknown>[];
    });
  }

  if (databaseType === "MYSQL" || databaseType === "MARIADB") {
    return withMysqlConnection(config, secret, timeoutMs, async (connection) => {
      const [rows] = await connection.query(`SELECT * FROM ${table} LIMIT ?`, [safeLimit]);
      return rows as Record<string, unknown>[];
    });
  }

  return sqlServerUnavailable();
}

export async function findDatabaseUser(
  databaseType: SupportedDatabaseType,
  rawConfig: unknown,
  rawSecret: unknown,
  timeoutMs: number,
  usernameSourceField: string,
  username: string,
): Promise<Record<string, unknown> | null> {
  const config = normalizeDbConfig(rawConfig);
  const secret = normalizeDbSecret(rawSecret);
  if (!config.userTable) throw new AppError(400, "USER_TABLE_REQUIRED", "Select and save a user table first");
  assertIdentifier(usernameSourceField, "Username source field");
  const table = tableReference(databaseType, config, config.userTable);

  if (databaseType === "POSTGRESQL") {
    return withPostgresClient(config, secret, timeoutMs, async (client) => {
      const field = pgIdentifier(usernameSourceField);
      const result = await client.query(`SELECT * FROM ${table} WHERE ${field}::text = $1 LIMIT 1`, [username]);
      return (result.rows[0] as Record<string, unknown> | undefined) ?? null;
    });
  }

  if (databaseType === "MYSQL" || databaseType === "MARIADB") {
    return withMysqlConnection(config, secret, timeoutMs, async (connection) => {
      const field = mysqlIdentifier(usernameSourceField);
      const [rows] = await connection.query(`SELECT * FROM ${table} WHERE CAST(${field} AS CHAR) = ? LIMIT 1`, [username]);
      return ((rows as Record<string, unknown>[])[0] as Record<string, unknown> | undefined) ?? null;
    });
  }

  return sqlServerUnavailable();
}
