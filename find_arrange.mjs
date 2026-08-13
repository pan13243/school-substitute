import { readFileSync } from 'fs';
const content = readFileSync('functions/api/[[path]].js', 'utf8');
const lines = content.split('\n');
for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('安排') || lines[i].includes('记录已生成')) {
        console.log(`Line ${i+1}: ${lines[i].trim().substring(0,120)}`);
    }
}
