import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
for (const file of process.argv.slice(2)) {
  const directory = mkdtempSync(join(tmpdir(), 'folga-tests-'));
  const result = spawnSync(process.execPath, ['--import', 'tsx', file], { stdio: 'inherit', env: { ...process.env, DATABASE_URL:'', DOTENV_CONFIG_PATH:join(directory,'absent.env'), NODE_ENV: 'test', DB_PATH: join(directory, 'test.db'), ALLOW_DATABASE_RESET: '1', TZ:'America/Sao_Paulo' } });
  rmSync(directory, {recursive:true,force:true});
  if (result.status !== 0) process.exit(result.status || 1);
}
