const db = require('../config/db'); // اتصال به دیتابیس (مثلاً با pg-promise یا هر ORM)

async function createLog({ logType, source, message, data, deviceId }) {
    const query = `
        INSERT INTO logs (log_type, source, message, data, device_id)
        VALUES ($1, $2, $3, $4, $5)
    `;
    const values = [logType, source, message, data, deviceId];
    try {
        await db.query(query, values);
    } catch (err) {
        console.error('Error while creating log:', err);
    }
}

module.exports = {
    createLog
};