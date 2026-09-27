import {readFile,writeFile} from 'node:fs/promises';
const snapshot=JSON.parse(await readFile(new URL('./archive-snapshot.json',import.meta.url)));
const quote=s=>"'"+String(s).replaceAll("'","''")+"'";
let sql=await readFile(new URL('./schema.sql',import.meta.url),'utf8');
for(const item of snapshot.items) sql+=`\nINSERT OR IGNORE INTO records(id,data) VALUES(${Number(item.id)},${quote(JSON.stringify(item))});`;
await writeFile(new URL('./seed.sql',import.meta.url),sql);
console.log(`Prepared ${snapshot.items.length} existing records`);
