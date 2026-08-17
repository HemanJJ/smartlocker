import { getDb } from './db';

export interface Venue {
  id: number;
  slug: string;
  name: string;
  address: string;
  phone: string;
  cellCount: number;
  price: number;
  isActive: boolean;
}

export async function listVenues(activeOnly = true): Promise<Venue[]> {
  const sql = getDb();
  const rows = activeOnly
    ? await sql`SELECT * FROM venues WHERE is_active = TRUE ORDER BY id`
    : await sql`SELECT * FROM venues ORDER BY id`;
  return rows.map(rowToVenue);
}

export async function getVenueBySlug(slug: string): Promise<Venue | null> {
  const sql = getDb();
  const rows = await sql`SELECT * FROM venues WHERE slug = ${slug} AND is_active = TRUE`;
  return rows.length ? rowToVenue(rows[0]) : null;
}

export async function getVenueById(id: number): Promise<Venue | null> {
  const sql = getDb();
  const rows = await sql`SELECT * FROM venues WHERE id = ${id}`;
  return rows.length ? rowToVenue(rows[0]) : null;
}

function rowToVenue(row: any): Venue {
  return {
    id: Number(row.id),
    slug: row.slug,
    name: row.name,
    address: row.address,
    phone: row.phone,
    cellCount: Number(row.cell_count),
    price: Number(row.price ?? 0),
    isActive: Boolean(row.is_active),
  };
}
