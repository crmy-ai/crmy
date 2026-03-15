import * as jose from 'jose';
import pg from 'pg';
const pool = new pg.Pool({ connectionString: 'postgres://postgres:postgres@localhost:5432/crmy' });
const r = await pool.query("SELECT u.id, u.email, u.role, t.id AS tenant_id FROM users u JOIN tenants t ON u.tenant_id = t.id WHERE u.role = 'owner' LIMIT 1");
const user = r.rows[0];
const secret = new TextEncoder().encode('dev-secret-change-me');
const token = await new jose.SignJWT({ sub: user.id, tenant_id: user.tenant_id, role: user.role })
  .setProtectedHeader({ alg: 'HS256' })
  .setIssuedAt()
  .setExpirationTime('24h')
  .sign(secret);
const userJson = JSON.stringify({ id: user.id, email: user.email, name: user.email, role: user.role, tenant_id: user.tenant_id });
console.log(token);
console.log(userJson);
await pool.end();
