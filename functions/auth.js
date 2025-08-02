const pool = require('../config/db');

async function authMiddleware(req, res, next) {
  const token = req.headers['authorization']?.split(' ')[1];
  
  

  if (!token) {
    return res.status(401).json({ message: 'token not found' });
  }

  const result = await pool.query('SELECT id FROM users WHERE auth_token = $1', [token]);

  if (result.rows.length === 0) {
    return res.status(401).json({ message: 'invalid token' });
  }

  req.user = result.rows[0];
  
  next();
}

module.exports = authMiddleware;
