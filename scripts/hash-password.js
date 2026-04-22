/**
 * Password Hashing Utility
 * Run: npm run hash-password
 * Then set the output as ADMIN_PASSWORD_HASH environment variable
 */

const bcrypt = require('bcrypt');
const readline = require('readline');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

rl.question('Enter the password to hash: ', async (password) => {
    if (!password || password.length < 8) {
        console.error('Password must be at least 8 characters');
        rl.close();
        process.exit(1);
    }

    const hash = await bcrypt.hash(password, 12);
    console.log('\n✅ Password hashed successfully!\n');
    console.log('Set this as your ADMIN_PASSWORD_HASH environment variable:\n');
    console.log(hash);
    console.log('\n');
    rl.close();
});
