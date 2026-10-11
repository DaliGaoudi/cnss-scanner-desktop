const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { getConfig } = require('../config');

/*
 * Single shared password. The whole office uses one password; there is no users
 * table. On success we issue a token whose payload is CONSTANT so the routes'
 * `WHERE id_so = ?` checks always match.
 */
const CONSTANT_USER = { id: 1, id_so: '1', username: 'office', role: 'admin' };

router.post('/login', async (req, res) => {
    try {
        const { password } = req.body || {};
        const cfg = getConfig();
        const ok = password && bcrypt.compareSync(String(password), cfg.passwordHash);
        if (!ok) return res.status(401).json({ error: 'كلمة المرور غير صحيحة' });

        const token = jwt.sign(CONSTANT_USER, cfg.jwtSecret, { expiresIn: '30d' });
        res.json({
            user: { id: CONSTANT_USER.id, username: CONSTANT_USER.username, role: CONSTANT_USER.role },
            token,
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
