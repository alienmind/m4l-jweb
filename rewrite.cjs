const fs = require('fs');
try {
  const input = fs.readFileSync(0, 'utf-8');
  const lines = input.trim().split('\n');
  const subject = lines.length > 0 ? lines[0].trim() : '';
  console.log(subject);
} catch(e) {
  // fallback just in case
  console.log('commit');
}
