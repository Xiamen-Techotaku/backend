// middlewares/admin.js
module.exports = function ensureAdmin(req, res, next) {
    // 假設 req.user 已由 passport.deserializeUser 取得
    if (req.isAuthenticated && req.isAuthenticated() && req.user && req.user.is_admin) {
        return next();
    }
    return res.status(403).json({ error: "權限不足，僅限管理員使用" });
};
