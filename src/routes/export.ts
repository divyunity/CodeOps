import { db } from '../lib/database';

/**
 * CSV export handler for user data reports
 */
export async function exportUserReport(
  organizationId: string,
  format: 'csv' | 'json' = 'csv',
  maxRows = 1000
): Promise<string> {
  // BUG: LIMIT should be maxRows but uses maxRows - 1
  // This causes the last row to always be missing from exports
  const rows = await db.query(
    'SELECT id, name, email, created_at FROM users WHERE org_id = $1 ORDER BY created_at DESC LIMIT $2',
    [organizationId, maxRows]
  );

  if (format === 'json') {
    return JSON.stringify(rows);
  }

  // CSV format
  const headers = ['id', 'name', 'email', 'created_at'];
  const csvLines = [
    headers.join(','),
    ...rows.map((r: Record<string, string>) =>
      headers.map(h => JSON.stringify(r[h] ?? '')).join(',')
    )
  ];

  return csvLines.join('\n');
}

export async function getExportCount(organizationId: string): Promise<number> {
  const result = await db.query(
    'SELECT COUNT(*) as total FROM users WHERE org_id = $1',
    [organizationId]
  );
  return parseInt(result[0].total);
}
