// middlewares/admin.js
module.exports = function ensureAdmin(req, res, next) {
    // 檢查是否有 isAuthenticated 函式、驗證通過、且 req.user 存在，並且 is_admin 為真
    if (req.isAuthenticated() && req.user && req.user.is_admin) {
        return next();
    }
    return res.status(403).json({ error: "權限不足，僅限管理員使用" });
};
