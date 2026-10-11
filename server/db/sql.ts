// Parameter markers are replaced only outside SQL literals and identifiers.
export function postgresSql(sql: string): string {
  sql = sql.replace(/datetime\('now',\s*'localtime'\)/g, "to_char(CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI:SS')");
  let result = '', quote = '', index = 0;
  for (let i=0; i<sql.length; i++) {
    const c = sql[i];
    if (quote) {
      result += c;
      if (c === quote) {
        if (sql[i+1] === quote) result += sql[++i];
        else quote = '';
      }
    } else if (c === "'" || c === '"') { quote = c; result += c; }
    else result += c === '?' ? '$' + ++index : c;
  }
  return result;
}
