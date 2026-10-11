import db, {dialect,transaction} from './connection';
import {hashPassword} from '../utils/auth';

export async function bootstrapProduction() {
  if (process.env.NODE_ENV !== 'production') return;
  await transaction(async () => {
    if (dialect==='postgres' && process.env.TEST_DATABASE!=='postgres') await db.prepare('SELECT pg_advisory_xact_lock(?)').get(74192302);
    const existing = await db.prepare('SELECT id FROM users LIMIT 1').get();
    if (!existing) {
      const email = process.env.INITIAL_ADMIN_EMAIL?.trim().toLowerCase();
      const password = process.env.INITIAL_ADMIN_PASSWORD;
      const name = process.env.INITIAL_ADMIN_NAME?.trim() || 'Administrador';
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password || password.length<12) {
        throw new Error('Banco vazio: configure INITIAL_ADMIN_EMAIL e INITIAL_ADMIN_PASSWORD (mínimo 12 caracteres) no Render.');
      }
      await db.prepare("INSERT INTO users(name,email,password_hash,role) VALUES (?,?,?,'ADMIN')").run(name,email,hashPassword(password));
      console.log('Administrador inicial criado.');
    }
    for (const [key,value] of Object.entries({company_name:'Minha empresa',manager_name:'Administrador',clt_alert_days:'6',onboarding_completed:'false'})) {
      await db.prepare('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO NOTHING').run(key,value);
    }
  });
}
