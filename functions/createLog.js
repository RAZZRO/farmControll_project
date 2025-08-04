const pool = require('../config/db');

async function createLog({ logType, source, message, data, deviceId }) {
    const query = `
        INSERT INTO logs (log_type, source, message, data, device_id)
        VALUES ($1, $2, $3, $4, $5)
    `;
    const values = [logType, source, message, data, deviceId];

    try {
       const result = await pool.query(query, values);
       console.log("log result is :");
       
       console.log(result);
       
    } catch (err) {
        console.error('Error while creating log:', err);
    }
}

module.exports = {
    createLog
};