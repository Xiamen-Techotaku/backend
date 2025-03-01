// routes/auth.js
const express = require("express");
const router = express.Router();
const passport = require("passport");
const pool = require("../db"); // 資料庫連線模組
const bcrypt = require("bcrypt");
const ensureAdmin = require("../middlewares/admin");

// ------------------------
// Passport 驗證中介層
// ------------------------
function ensureAuthenticated(req, res, next) {
    if (req.isAuthenticated()) {
        return next();
    }
    return res.status(401).json({ error: "未登入" });
}

// ========================
// 1. 註冊 (Register)
// ========================
router.post("/register", async (req, res, next) => {
    const { name, email, password, confirmPassword } = req.body;

    // 驗證所有必要欄位都有填寫
    if (!name || !email || !password || !confirmPassword) {
        return res.status(400).json({ error: "請填寫所有欄位" });
    }

    // 檢查密碼與確認密碼是否相符
    if (password !== confirmPassword) {
        return res.status(400).json({ error: "密碼與確認密碼不相符" });
    }

    try {
        // 檢查電子信箱是否已存在
        const [rows] = await pool.execute("SELECT id FROM users WHERE email = ?", [email]);
        if (rows.length > 0) {
            return res.status(400).json({ error: "此電子信箱已註冊" });
        }

        // 密碼雜湊
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        // 將新使用者資料寫入資料庫
        const [result] = await pool.execute(
            "INSERT INTO users (name, email, password) VALUES (?, ?, ?)",
            [name, email, hashedPassword]
        );

        res.json({ message: "註冊成功", userId: result.insertId });
    } catch (err) {
        next(err);
    }
});

// ========================
// 2. 本地登入 (Local Login)
// ========================
router.post("/login", passport.authenticate("local"), (req, res) => {
    // 若通過本地策略驗證，Passport 會將使用者資料存入 req.user，
    // 並透過 express-session 建立 session
    res.json({ message: "登入成功", user: req.user });
});

// ========================
// 3. Google 登入 (Google Login)
// ========================

// 啟動 Google 認證流程
router.get("/google", passport.authenticate("google", { scope: ["profile", "email"] }));

// Google 登入回調路由
router.get(
    "/google/callback",
    passport.authenticate("google", { failureRedirect: "/login" }),
    (req, res) => {
        // 登入成功後，session 已建立
        // 導向前端頁面，請根據你的前端 URL 調整
        res.redirect("http://localhost:3000");
    }
);

// ========================
// 4. 登出 (Logout)
// ========================
router.get("/logout", (req, res, next) => {
    req.logout(function (err) {
        if (err) {
            return next(err);
        }
        res.json({ message: "登出成功" });
    });
});

// ========================
// 5. 取得目前登入使用者 (Get Current User)
// ========================
router.get("/me", (req, res) => {
    if (req.isAuthenticated()) {
        // 回傳目前 session 中的使用者資料
        res.json({ user: req.user });
    } else {
        res.status(401).json({ message: "未登入" });
    }
});

// ========================
// 6. 更新個人資料 (Profile)
// ========================
router.put("/profile", ensureAuthenticated, async (req, res, next) => {
    // 前端會傳入要更新的資料，例如：
    // { name: "...", pickup_name: "...", pickup_phone: "..." }
    const userId = req.user.id; // 目前登入使用者的 ID
    const { name, pickup_name, pickup_phone } = req.body;

    try {
        // 可視情況做更多驗證，例如判斷字串長度、電話格式等
        await pool.execute(
            `
        UPDATE users
        SET name = ?, pickup_name = ?, pickup_phone = ?
        WHERE id = ?
      `,
            [name, pickup_name, pickup_phone, userId]
        );
        // 更新完成後，可以重新撈取最新的使用者資料回傳
        const [rows] = await pool.execute("SELECT * FROM users WHERE id = ?", [userId]);
        if (rows.length === 0) {
            return res.status(404).json({ error: "找不到使用者" });
        }
        // 這裡也可以刪除敏感資訊（如密碼）再回傳
        const updatedUser = rows[0];
        delete updatedUser.password;
        res.json({ message: "更新成功", user: updatedUser });
    } catch (err) {
        console.error("更新個人資料失敗：", err);
        next(err);
    }
});

router.get("/admin", ensureAdmin, (req, res) => {
    // 回傳目前 session 中的管理員資料
    res.json({ user: req.user });
});

module.exports = router;
