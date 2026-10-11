const jwt = require('jsonwebtoken');
const { getConfig } = require('../config');

/*
 * Authentication middleware.
 *
 * Single-office build: every successful login issues a token with a CONSTANT
 * payload (id=1, id_so='1', username='office'). We still verify the token here,
 * exactly like the original, so every `WHERE id_so = ?` in the routes keeps
 * matching the constant and works unchanged.
 */
function authenticate(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access denied. No token provided.' });
    }

    try {
        const decoded = jwt.verify(token, getConfig().jwtSecret);
        req.user = decoded;
        if (req.user.id_so) req.user.id_so = String(req.user.id_so);
        next();
    } catch (err) {
        res.status(403).json({ error: 'Invalid or expired token.' });
    }
}

module.exports = authenticate;
