import { runSeed } from './seed';
import db from './connection';
console.log('🔄 Reiniciando banco de dados...');
await runSeed();
console.log('✨ Banco de dados reiniciado e pronto!');
await db.close();
